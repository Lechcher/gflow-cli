import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { BROWSER_CHANNELS, DEFAULT_BROWSER_CHANNEL, launchLoginChrome, openBrowserSession, type BrowserChannel } from "./browser/session.js";
import { exitCodeForError, messageForError } from "./errors.js";
import { FlowPage, FLOW_URL } from "./flow/page.js";
import type { AgentAutomation, CharacterAutomation, EditAutomation, FlowAutomation, MusicAutomation, SceneAutomation, ToolAutomation } from "./flow/types.js";
import { AgentPage } from "./flow/agent.js";
import { CharacterPage } from "./flow/characters.js";
import { EditPage } from "./flow/edit.js";
import { MUSIC_DOWNLOAD_FORMATS } from "./flow/locators.js";
import { MusicPage } from "./flow/music.js";
import { ScenePage } from "./flow/scene.js";
import { ToolPage } from "./flow/tools.js";
import { parseAgentInstruction, parseAgentRun, parseAgentSettings, parseBatchYaml, parseCharacter, parseEditMedia, parseExtendScene, parseImageJob, parseMusicJob, parseTool, parseVideoJob } from "./jobs/schema.js";
import { compositeAutomation, runJobs } from "./jobs/runner.js";
import { resolveOutputDir } from "./config/paths.js";

/**
 * Injection points for {@link createProgram}. Every field is optional; when a
 * field is omitted the corresponding command drives the real Google Flow
 * browser automation. The test suite embeds the CLI by injecting fakes here
 * (see `tests/cli.test.ts`).
 */
export interface CreateProgramOptions {
  /** Image/video creation surface (`FlowPage`) behind `gflow image`, `gflow video`, and `gflow batch`'s image/video jobs. */
  automation?: FlowAutomation;
  /** Character surface (`CharacterPage`) behind `gflow character`. */
  characterAutomation?: CharacterAutomation;
  /** Tool surface (`ToolPage`) behind `gflow tool`. */
  toolAutomation?: ToolAutomation;
  /** Agent surface (`AgentPage`) behind `gflow agent` and `gflow batch`'s agent jobs. */
  agentAutomation?: AgentAutomation;
  /** Edit surface (`EditPage`) behind `gflow edit`. */
  editAutomation?: EditAutomation;
  /** Scenebuilder surface (`ScenePage`) behind `gflow extend` and `gflow scene`. */
  sceneAutomation?: SceneAutomation;
  /** Google Flow Music surface (`MusicPage`) behind `gflow music`. */
  musicAutomation?: MusicAutomation;
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseIntegerOption(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  return Number.parseInt(value, 10);
}

function parseBrowserOption(value: string): BrowserChannel {
  if (!BROWSER_CHANNELS.includes(value as BrowserChannel)) {
    throw new InvalidArgumentError(`must be one of: ${BROWSER_CHANNELS.join(", ")}`);
  }
  return value as BrowserChannel;
}

function commandOption<T>(command: unknown, key: string): T | undefined {
  if (command === null || typeof command !== "object") return undefined;
  const record = command as Record<string, unknown>;
  if (record[key] !== undefined) return record[key] as T;
  const optsWithGlobals = record.optsWithGlobals;
  if (typeof optsWithGlobals === "function") {
    const value = (optsWithGlobals.call(command) as Record<string, unknown>)[key];
    if (value !== undefined) return value as T;
  }
  const opts = record.opts;
  if (typeof opts === "function") {
    const value = (opts.call(command) as Record<string, unknown>)[key];
    if (value !== undefined) return value as T;
  }
  return undefined;
}

/**
 * Read the CLI version from `package.json` so `--version` never drifts from the
 * published package. Two anchors are probed relative to this module because dev
 * runs from `src/` (package.json one level up) while the build runs from
 * `dist/src/` (two levels up).
 *
 * @returns the package version, or `"0.0.0"` when no package.json can be read.
 */
export function resolveVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of ["../package.json", "../../package.json"]) {
    try {
      return (JSON.parse(readFileSync(join(here, rel), "utf8")) as { version: string }).version;
    } catch {
      // try the next candidate
    }
  }
  return "0.0.0";
}

async function realAutomation(profile: string, headed: boolean, browser: BrowserChannel): Promise<{ automation: FlowAutomation; close(): Promise<void> }> {
  const session = await openBrowserSession({ profile, headed, browser });
  const flow = new FlowPage(session.page);
  await flow.open();
  return {
    automation: flow,
    close: () => session.close()
  };
}

function withSessionOptions(command: Command): Command {
  return command
    .option("--project <name>", "Flow project")
    .option("--profile <name>", "browser profile name", "default")
    .option("--browser <name>", "browser channel for Flow automation: chrome or chromium", parseBrowserOption, DEFAULT_BROWSER_CHANNEL)
    .option("--headed", "show browser", true)
    .option("--no-headed", "run browser headless");
}

function nestedSessionOptions(commandOptions: unknown, command: unknown): {
  project?: string;
  profile: string;
  headed: boolean;
  browser: BrowserChannel;
} {
  return {
    project: commandOption<string>(command, "project") ?? commandOption<string>(commandOptions, "project"),
    profile: commandOption<string>(command, "profile") ?? commandOption<string>(commandOptions, "profile") ?? "default",
    headed: commandOption<boolean>(command, "headed") ?? commandOption<boolean>(commandOptions, "headed") ?? true,
    browser: commandOption<BrowserChannel>(command, "browser") ?? commandOption<BrowserChannel>(commandOptions, "browser") ?? DEFAULT_BROWSER_CHANNEL
  };
}

async function realCharacterAutomation(profile: string, headed: boolean, browser: BrowserChannel): Promise<{ automation: CharacterAutomation; close(): Promise<void> }> {
  const session = await openBrowserSession({ profile, headed, browser });
  await session.page.goto(FLOW_URL, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  return { automation: new CharacterPage(session.page), close: () => session.close() };
}

async function realToolAutomation(profile: string, headed: boolean, browser: BrowserChannel): Promise<{ automation: ToolAutomation; close(): Promise<void> }> {
  const session = await openBrowserSession({ profile, headed, browser });
  await session.page.goto(FLOW_URL, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  return { automation: new ToolPage(session.page), close: () => session.close() };
}

async function realAgentAutomation(profile: string, headed: boolean, browser: BrowserChannel): Promise<{ automation: AgentAutomation; close(): Promise<void> }> {
  const session = await openBrowserSession({ profile, headed, browser });
  await session.page.goto(FLOW_URL, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  return { automation: new AgentPage(session.page), close: () => session.close() };
}

// Batch pipelines can mix create jobs and agent jobs, so they run both surfaces
// against one browser session.
async function realBatchAutomations(profile: string, headed: boolean, browser: BrowserChannel): Promise<{
  flow: FlowAutomation;
  agent: AgentAutomation;
  close(): Promise<void>;
}> {
  const session = await openBrowserSession({ profile, headed, browser });
  const flow = new FlowPage(session.page);
  await flow.open();
  return { flow, agent: new AgentPage(session.page), close: () => session.close() };
}

async function realSceneAutomation(profile: string, headed: boolean, browser: BrowserChannel): Promise<{ automation: SceneAutomation; close(): Promise<void> }> {
  const session = await openBrowserSession({ profile, headed, browser });
  await session.page.goto(FLOW_URL, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  return { automation: new ScenePage(session.page), close: () => session.close() };
}

async function realEditAutomation(profile: string, headed: boolean, browser: BrowserChannel): Promise<{ automation: EditAutomation; close(): Promise<void> }> {
  const session = await openBrowserSession({ profile, headed, browser });
  await session.page.goto(FLOW_URL, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  return { automation: new EditPage(session.page), close: () => session.close() };
}

// Flow Music is a separate signed-in surface, so it runs in its own tab of the same
// session. runSong/open navigate and clear the first-run dialog themselves.
async function realMusicAutomation(profile: string, headed: boolean, browser: BrowserChannel): Promise<{ automation: MusicAutomation; close(): Promise<void> }> {
  const session = await openBrowserSession({ profile, headed, browser });
  const music = new MusicPage(await session.context.newPage());
  return { automation: music, close: () => session.close() };
}

// doctor checks both signed-in surfaces in one session: the Flow tab and a fresh
// Flow Music tab.
async function realDoctorSurfaces(profile: string, headed: boolean, browser: BrowserChannel): Promise<{
  flow: FlowAutomation | undefined;
  music: MusicAutomation | undefined;
  close(): Promise<void>;
}> {
  const session = await openBrowserSession({ profile, headed, browser });
  const flow = new FlowPage(session.page);
  const music = new MusicPage(await session.context.newPage());
  try {
    await flow.open();
    await music.open();
  } catch (error) {
    await session.close();
    throw error;
  }
  return { flow, music, close: () => session.close() };
}

/**
 * Build the `gflow` commander program with every top-level command wired up:
 * `auth`, `doctor`, `image`, `video`, `agent`, `batch`, `character`, `edit`,
 * `extend`, `scene`, `tool`, `music`, and `media`. Each command drives the Google Flow
 * browser automation unless an injected fake replaces its surface.
 *
 * @param options optional automation fakes — see {@link CreateProgramOptions}.
 * Ordinary consumers pass nothing and gflow drives the real signed-in Chrome
 * profile; tests (and other embedders) inject fakes so no browser is needed.
 * @returns the configured commander program, ready for `parseAsync`.
 *
 * @example Parse a real command line
 * ```ts
 * import { createProgram } from "@lechcher/gflow-cli";
 *
 * await createProgram().parseAsync([
 *   "node", "gflow", "image", "--prompt", "a neon-lit alley at night"
 * ]);
 * ```
 *
 * @example Run against an injected fake automation
 * ```ts
 * import { createProgram } from "@lechcher/gflow-cli";
 *
 * const program = createProgram({
 *   automation: {
 *     async runJob(input) {
 *       return { jobId: input.job.id, artifacts: [], flowUrl: "https://flow.google.com" };
 *     }
 *   }
 * });
 * await program.parseAsync(["node", "gflow", "video", "--prompt", "rain on the alley"]);
 * ```
 */
export function createProgram(options: CreateProgramOptions = {}): Command {
  const program = new Command();
  program.name("gflow").description("Local browser automation CLI for Google Flow.").version(resolveVersion());
  program.exitOverride();

  const auth = program.command("auth").description("Manage the local Flow browser session.");
  auth
    .command("login")
    .description("Open a plain Chrome to sign in to Google Flow (run before other commands).")
    .option("--profile <name>", "browser profile name", "default")
    .action(async (command: { profile: string }) => {
      // Launch a plain Chrome (no remote-debugging port) for sign-in. Google blocks sign-in
      // in browsers with remote debugging enabled ("this browser or app may not be secure"),
      // so login must happen in an ordinary window. Automation commands then reattach to this
      // profile with a debugging port once it is already signed in.
      const profileDir = await launchLoginChrome(command.profile);
      console.log(`Opened Google Chrome for login with profile: ${profileDir}`);
      console.log("Complete login in that window, then run `gflow doctor` (gflow reopens Chrome for automation).");
    });

  program
    .command("doctor")
    .description("Check that both browser surfaces (Google Flow and Flow Music) are signed in and ready.")
    .option("--profile <name>", "browser profile name", "default")
    .option("--browser <name>", "browser channel for Flow automation: chrome or chromium", parseBrowserOption, DEFAULT_BROWSER_CHANNEL)
    .option("--headed", "show browser", true)
    .option("--no-headed", "run browser headless")
    .action(async (command) => {
      // Injected surfaces keep doctor testable: an injected fake's assertReady decides
      // readiness, and the real Chrome path checks both surfaces in one session.
      const owned = options.automation || options.musicAutomation
        ? { flow: options.automation, music: options.musicAutomation, close: async () => undefined }
        : await realDoctorSurfaces(command.profile, command.headed, command.browser);
      try {
        if (owned.flow instanceof FlowPage) {
          await owned.flow.assertReady();
          console.log("gflow doctor: Google Flow is signed in and ready.");
        }
        if (owned.music) {
          await owned.music.assertReady();
          console.log("gflow doctor: Google Flow Music is signed in and ready.");
        }
        console.log("gflow doctor: browser session looks ready.");
      } finally {
        await owned.close();
      }
    });

  program
    .command("image")
    .description("Generate an image from a text prompt.")
    .requiredOption("--id <id>", "job id")
    .requiredOption("--prompt <text>", "generation prompt")
    .option("--project <name>", "Flow project")
    .option("--model <name>", "Flow-visible model")
    .option("--ratio <ratio>", "Flow-visible aspect ratio")
    .option("--outputs <n>", "number of outputs", parseIntegerOption, 1)
    .option("--timeout <seconds>", "generation timeout in seconds", parseIntegerOption)
    .option("--out <path>", "output directory", "./gflow-output")
    .option("--character <name...>", "reference saved character(s) by name")
    .option("--upscale <tier>", "download upscaled output: 2k or 4k", (v) => {
      if (!["2k", "4k"].includes(v)) throw new InvalidArgumentError("must be 2k or 4k");
      return v;
    })
    .option("--profile <name>", "browser profile name", "default")
    .option("--browser <name>", "browser channel for Flow automation: chrome or chromium", parseBrowserOption, DEFAULT_BROWSER_CHANNEL)
    .option("--headed", "show browser", true)
    .option("--no-headed", "run browser headless")
    .action(async (command) => {
      const job = parseImageJob({
        id: command.id,
        type: "image",
        prompt: command.prompt,
        project: command.project,
        model: command.model,
        ratio: command.ratio,
        outputs: command.outputs,
        timeout: command.timeout,
        out: command.out,
        character: command.character ?? [],
        upscale: command.upscale
      });
      const outDir = resolveOutputDir(command.out);
      const owned = options.automation
        ? { automation: options.automation, close: async () => undefined }
        : await realAutomation(command.profile, command.headed, command.browser);
      try {
        const result = await owned.automation.runJob({ job, outDir });
        for (const artifact of result.artifacts) {
          console.log(`saved ${artifact.path}`);
        }
      } finally {
        await owned.close();
      }
    });

  program
    .command("video")
    .description("Generate a video from a prompt, referencing frame images with --start-frame/--end-frame.")
    .requiredOption("--id <id>", "job id")
    .requiredOption("--prompt <text>", "generation prompt")
    .option("--project <name>", "Flow project")
    .option("--model <name>", "Flow-visible model")
    .option("--ratio <ratio>", "Flow-visible aspect ratio")
    .option("--duration <seconds>", "requested length in seconds; recorded in metadata — Flow now sets length by the video model", parseIntegerOption)
    .option("--outputs <n>", "number of outputs", parseIntegerOption, 1)
    .option("--start-frame <path>", "first-frame image, attached as a reference")
    .option("--end-frame <path>", "last-frame image, attached as a reference")
    .option("--timeout <seconds>", "generation timeout in seconds", parseIntegerOption)
    .option("--out <path>", "output directory", "./gflow-output")
    .option("--character <name...>", "reference saved character(s) by name")
    .option("--upscale <tier>", "download upscaled output: 2k or 4k", (v) => {
      if (!["2k", "4k"].includes(v)) throw new InvalidArgumentError("must be 2k or 4k");
      return v;
    })
    .option("--profile <name>", "browser profile name", "default")
    .option("--browser <name>", "browser channel for Flow automation: chrome or chromium", parseBrowserOption, DEFAULT_BROWSER_CHANNEL)
    .option("--headed", "show browser", true)
    .option("--no-headed", "run browser headless")
    .action(async (command) => {
      const job = parseVideoJob({
        id: command.id,
        type: "video",
        prompt: command.prompt,
        project: command.project,
        model: command.model,
        ratio: command.ratio,
        duration: command.duration,
        outputs: command.outputs,
        startFrame: command.startFrame ? resolve(process.cwd(), command.startFrame) : undefined,
        endFrame: command.endFrame ? resolve(process.cwd(), command.endFrame) : undefined,
        timeout: command.timeout,
        out: command.out,
        character: command.character ?? [],
        upscale: command.upscale
      });
      const outDir = resolveOutputDir(command.out);
      const owned = options.automation
        ? { automation: options.automation, close: async () => undefined }
        : await realAutomation(command.profile, command.headed, command.browser);
      try {
        const result = await owned.automation.runJob({ job, outDir });
        for (const artifact of result.artifacts) {
          console.log(`saved ${artifact.path}`);
        }
      } finally {
        await owned.close();
      }
    });

  program
    .command("batch")
    .description("Run a YAML pipeline of image/video jobs.")
    .argument("<file>", "YAML pipeline file")
    .option("--out <path>", "output directory", "./gflow-output")
    .option("--profile <name>", "browser profile name", "default")
    .option("--browser <name>", "browser channel for Flow automation: chrome or chromium", parseBrowserOption, DEFAULT_BROWSER_CHANNEL)
    .option("--headed", "show browser", true)
    .option("--no-headed", "run browser headless")
    .option("--continue-on-failure", "continue after ordinary generation failures", false)
    .action(async (file, command) => {
      const batch = parseBatchYaml(await readFile(file, "utf8"));
      const outDir = resolveOutputDir(command.out);
      const owned = options.automation || options.agentAutomation
        ? { flow: options.automation, agent: options.agentAutomation, close: async () => undefined }
        : await realBatchAutomations(command.profile, command.headed, command.browser);
      try {
        await runJobs({
          jobs: batch.jobs.map((job) => ({ ...job, out: command.out })),
          outDir,
          continueOnFailure: command.continueOnFailure,
          automation: compositeAutomation(owned.flow, owned.agent)
        });
      } finally {
        await owned.close();
      }
    });

  const character = program.command("character").description("Create and manage Flow characters.");
  withSessionOptions(character.command("create").description("Create a character from a prompt and optional reference images."))
    .requiredOption("--prompt <text>", "character description")
    .requiredOption("--name <name>", "character name")
    .option("--description <text>", "character info (how the character acts)")
    .option("--voice <voice>", "voice to assign to the character")
    .option("--model <model>", "nano-banana-2 or nano-banana-pro", (v) => {
      if (!["nano-banana-2", "nano-banana-pro"].includes(v)) throw new InvalidArgumentError("must be nano-banana-2 or nano-banana-pro");
      return v;
    })
    .option("--preset <preset>", "familiar|eccentric|wicked|fantastical")
    .option("--image <path...>", "reference image(s) to upload")
    .option("--from-project <name...>", "reference asset name(s) from the project")
    .option("--out <path>", "output directory", "./gflow-output")
    .action(async (command) => {
      const spec = parseCharacter({
        prompt: command.prompt,
        name: command.name,
        description: command.description,
        voice: command.voice,
        model: command.model,
        preset: command.preset,
        images: (command.image ?? []).map((p: string) => resolve(process.cwd(), p)),
        fromProject: command.fromProject ?? [],
        project: command.project,
        out: command.out
      });
      const owned = options.characterAutomation
        ? { automation: options.characterAutomation, close: async () => undefined }
        : await realCharacterAutomation(command.profile, command.headed, command.browser);
      try {
        const result = await owned.automation.createCharacter({ ...spec, outDir: resolveOutputDir(spec.out) });
        console.log(`character created: ${result.name}`);
        if (result.thumbnailPath) console.log(`saved ${result.thumbnailPath}`);
      } finally {
        await owned.close();
      }
    });

  withSessionOptions(character.command("list").description("List the project's characters.")).action(async (command) => {
    const owned = options.characterAutomation
      ? { automation: options.characterAutomation, close: async () => undefined }
      : await realCharacterAutomation(command.profile, command.headed, command.browser);
    try {
      for (const c of await owned.automation.listCharacters(command.project)) console.log(c.name);
    } finally {
      await owned.close();
    }
  });

  const tool = program.command("tool").description("Create and open Flow tools.");
  withSessionOptions(tool.command("create").description("Build a Flow tool (applet) from a description."))
    .requiredOption("--prompt <text>", "describe the tool to build")
    .option("--name <name>", "label for the created tool")
    .option("--preset <preset>", "image-filter|style-morph|time-stretcher|voice-over")
    .action(async (command) => {
      const spec = parseTool({ prompt: command.prompt, name: command.name, preset: command.preset, project: command.project });
      const owned = options.toolAutomation
        ? { automation: options.toolAutomation, close: async () => undefined }
        : await realToolAutomation(command.profile, command.headed, command.browser);
      try {
        const r = await owned.automation.createTool(spec);
        console.log(`tool created: ${r.name}`);
      } finally {
        await owned.close();
      }
    });

  withSessionOptions(tool.command("list").description("List the project's tools.")).action(async (command) => {
    const owned = options.toolAutomation
      ? { automation: options.toolAutomation, close: async () => undefined }
      : await realToolAutomation(command.profile, command.headed, command.browser);
    try {
      for (const t of await owned.automation.listTools(command.project)) console.log(t.name);
    } finally {
      await owned.close();
    }
  });

  withSessionOptions(tool.command("open").description("Open a tool by name."))
    .requiredOption("--name <name>", "tool to open")
    .action(async (command) => {
      const owned = options.toolAutomation
        ? { automation: options.toolAutomation, close: async () => undefined }
        : await realToolAutomation(command.profile, command.headed, command.browser);
      try {
        await owned.automation.openTool(command.name, command.project);
        console.log(`opened ${command.name}`);
      } finally {
        await owned.close();
      }
    });

  const agent = program.command("agent").description("Run and configure the Flow Agent.");
  withSessionOptions(agent)
    .option("--prompt <text>", "agent prompt")
    .option("--id <id>", "job id for outputs", "agent")
    .option("--photo <path...>", "local photo(s) to attach to the chat")
    .option("--video <path...>", "local video(s) to attach to the chat")
    .option("--from-project <name...>", "project media asset name(s) to attach to the chat")
    .option("--out <path>", "output directory", "./gflow-output")
    .action(async (command) => {
      if (!command.prompt) {
        agent.help();
        return;
      }
      const spec = parseAgentRun({
        id: command.id,
        prompt: command.prompt,
        project: command.project,
        out: command.out,
        photos: (command.photo ?? []).map((p: string) => resolve(process.cwd(), p)),
        videos: (command.video ?? []).map((p: string) => resolve(process.cwd(), p)),
        fromProject: command.fromProject ?? []
      });
      const owned = options.agentAutomation
        ? { automation: options.agentAutomation, close: async () => undefined }
        : await realAgentAutomation(command.profile, command.headed, command.browser);
      try {
        const r = await owned.automation.runAgent({ ...spec, outDir: resolveOutputDir(spec.out) });
        for (const a of r.artifacts) console.log(`saved ${a.path}`);
      } finally {
        await owned.close();
      }
    });

  withSessionOptions(agent.command("settings").description("Set the agent's image/video model, format, quantity, and confirmation mode."))
    .option("--confirm <mode>", "always or never", (v) => {
      if (!["always", "never"].includes(v)) throw new InvalidArgumentError("must be always or never");
      return v;
    })
    .option("--image-model <m>")
    .option("--image-ratio <r>")
    .option("--image-quantity <n>", "1-4", parseIntegerOption)
    .option("--video-model <m>")
    .option("--video-ratio <r>")
    .option("--video-quantity <n>", "1-4", parseIntegerOption)
    .action(async (commandOptions, command) => {
      const sessionOptions = nestedSessionOptions(commandOptions, command);
      const spec = parseAgentSettings({
        confirm: commandOptions.confirm,
        imageModel: commandOptions.imageModel,
        imageRatio: commandOptions.imageRatio,
        imageQuantity: commandOptions.imageQuantity,
        videoModel: commandOptions.videoModel,
        videoRatio: commandOptions.videoRatio,
        videoQuantity: commandOptions.videoQuantity,
        project: sessionOptions.project
      });
      const owned = options.agentAutomation
        ? { automation: options.agentAutomation, close: async () => undefined }
        : await realAgentAutomation(sessionOptions.profile, sessionOptions.headed, sessionOptions.browser);
      try {
        await owned.automation.applySettings(spec);
        console.log("agent settings saved");
      } finally {
        await owned.close();
      }
    });

  const instruction = agent.command("instruction").description("Manage agent instructions.");
  withSessionOptions(instruction.command("add").description("Add a guideline, optionally with a project image as reference."))
    .requiredOption("--text <guideline>", "guideline text")
    .option("--ref <name>", "project image to use as reference")
    .action(async (commandOptions, command) => {
      const sessionOptions = nestedSessionOptions(commandOptions, command);
      const spec = parseAgentInstruction({
        text: commandOptions.text,
        ref: commandOptions.ref,
        project: sessionOptions.project
      });
      const owned = options.agentAutomation
        ? { automation: options.agentAutomation, close: async () => undefined }
        : await realAgentAutomation(sessionOptions.profile, sessionOptions.headed, sessionOptions.browser);
      try {
        await owned.automation.addInstruction(spec);
        console.log("instruction added");
      } finally {
        await owned.close();
      }
    });
  withSessionOptions(instruction.command("list").description("List the agent's instructions.")).action(async (commandOptions, command) => {
    const sessionOptions = nestedSessionOptions(commandOptions, command);
    const owned = options.agentAutomation
      ? { automation: options.agentAutomation, close: async () => undefined }
      : await realAgentAutomation(sessionOptions.profile, sessionOptions.headed, sessionOptions.browser);
    try {
      for (const i of await owned.automation.listInstructions(sessionOptions.project)) console.log(i.text);
    } finally {
      await owned.close();
    }
  });
  withSessionOptions(instruction.command("clear").description("Remove all agent instructions.")).action(async (commandOptions, command) => {
    const sessionOptions = nestedSessionOptions(commandOptions, command);
    const owned = options.agentAutomation
      ? { automation: options.agentAutomation, close: async () => undefined }
      : await realAgentAutomation(sessionOptions.profile, sessionOptions.headed, sessionOptions.browser);
    try {
      await owned.automation.clearInstructions(sessionOptions.project);
      console.log("instructions cleared");
    } finally {
      await owned.close();
    }
  });

  const edit = program.command("edit").description("Edit an existing image or video in a project.");
  withSessionOptions(edit.command("image").description("Edit an image by describing the change."))
    .requiredOption("--media-id <id>", "unique media identifier (use `gflow media list` to find)")
    .requiredOption("--prompt <text>", "describe what to change")
    .option("--reference <path...>", "reference image(s) to upload")
    .option("--from-project <name...>", "reference asset name(s) from the project")
    .option("--timeout <seconds>", "generation timeout in seconds", parseIntegerOption)
    .option("--out <path>", "output directory", "./gflow-output")
    .action(async (command) => {
      const spec = parseEditMedia({
        mediaId: command.mediaId,
        prompt: command.prompt,
        referenceImages: (command.reference ?? []).map((p: string) => resolve(process.cwd(), p)),
        fromProject: command.fromProject ?? [],
        project: command.project,
        out: command.out,
        timeout: command.timeout
      });
      const owned = options.editAutomation
        ? { automation: options.editAutomation, close: async () => undefined }
        : await realEditAutomation(command.profile, command.headed, command.browser);
      try {
        const result = await owned.automation.editMedia({ ...spec, outDir: resolveOutputDir(spec.out) });
        for (const a of result.artifacts) console.log(`saved ${a.path}`);
      } finally {
        await owned.close();
      }
    });

  withSessionOptions(edit.command("video").description("Edit a video by describing the change."))
    .requiredOption("--media-id <id>", "unique media identifier (use `gflow media list` to find)")
    .requiredOption("--prompt <text>", "describe what to change")
    .option("--reference <path...>", "reference media to upload")
    .option("--from-project <name...>", "reference asset name(s) from the project")
    .option("--timeout <seconds>", "generation timeout in seconds", parseIntegerOption)
    .option("--out <path>", "output directory", "./gflow-output")
    .action(async (command) => {
      const spec = parseEditMedia({
        mediaId: command.mediaId,
        prompt: command.prompt,
        referenceImages: (command.reference ?? []).map((p: string) => resolve(process.cwd(), p)),
        fromProject: command.fromProject ?? [],
        project: command.project,
        out: command.out,
        timeout: command.timeout
      });
      const owned = options.editAutomation
        ? { automation: options.editAutomation, close: async () => undefined }
        : await realEditAutomation(command.profile, command.headed, command.browser);
      try {
        const result = await owned.automation.editMedia({ ...spec, outDir: resolveOutputDir(spec.out) });
        for (const a of result.artifacts) console.log(`saved ${a.path}`);
      } finally {
        await owned.close();
      }
    });

  withSessionOptions(
    program
      .command("extend")
      .description("Extend a video into a longer scene: each --prompt adds ~7s (max 148s total), --add-clip appends existing project videos.")
  )
    .option("--media-id <id>", "video to start a NEW scene from (see `gflow media list`)")
    .option("--scene <id>", "existing scene to continue (see `gflow scene list`)")
    .option("--prompt <text>", "what happens next; repeat the flag to chain multiple extends in order", collectOption, [])
    .option("--add-clip <ref>", "project video to append, by media id or visible name; repeatable", collectOption, [])
    .option("--id <id>", "job id for output files", "scene")
    .option("--no-download", "skip downloading the combined scene video")
    .option("--timeout <seconds>", "timeout per extend step", parseIntegerOption)
    .option("--out <path>", "output directory", "./gflow-output")
    .action(async (command) => {
      const spec = parseExtendScene({
        id: command.id,
        mediaId: command.mediaId,
        scene: command.scene,
        prompts: command.prompt,
        addClips: command.addClip,
        project: command.project,
        out: command.out,
        timeout: command.timeout,
        download: command.download
      });
      const owned = options.sceneAutomation
        ? { automation: options.sceneAutomation, close: async () => undefined }
        : await realSceneAutomation(command.profile, command.headed, command.browser);
      try {
        const result = await owned.automation.extendScene({ ...spec, outDir: resolveOutputDir(spec.out) });
        if (result.sceneId) console.log(`scene ${result.sceneId} (${result.totalDuration}) — continue it with --scene ${result.sceneId}`);
        for (const artifact of result.artifacts) console.log(`saved ${artifact.path}`);
      } finally {
        await owned.close();
      }
    });

  const scene = program.command("scene").description("Inspect scenebuilder scenes.");
  withSessionOptions(scene.command("list").description("List the project's scenes with their ids.")).action(async (command) => {
    const owned = options.sceneAutomation
      ? { automation: options.sceneAutomation, close: async () => undefined }
      : await realSceneAutomation(command.profile, command.headed, command.browser);
    try {
      const scenes = await owned.automation.listScenes(command.project);
      for (const item of scenes) console.log(item.name ? `${item.id} ${item.name}` : item.id);
      if (scenes.length === 0) console.log("No scenes found in the project.");
    } finally {
      await owned.close();
    }
  });

  const media = program.command("media").description("Inspect project media assets.");
  withSessionOptions(media.command("list").description("List all images and videos in the project with their unique IDs.")).action(async (command) => {
    const owned = options.editAutomation
      ? { automation: options.editAutomation, close: async () => undefined }
      : await realEditAutomation(command.profile, command.headed, command.browser);
    try {
      const items = await owned.automation.listProjectMedia(command.project);
      for (const item of items) {
        const label = item.name ? `${item.id} ${item.type} ${item.name}` : `${item.id} ${item.type}`;
        console.log(label);
      }
      if (items.length === 0) console.log("No media found in the project.");
    } finally {
      await owned.close();
    }
  });

  program
    .command("music")
    .description("Generate a song from a prompt with Google Flow Music.")
    .requiredOption("--id <id>", "job id")
    .requiredOption("--prompt <text>", "song description for the Producer chat")
    .option("--style <text>", "style/sound description (Flow Music's Sound panel)")
    .option("--lyrics <text>", "lyrics text to bring to the song")
    .option("--lyrics-file <path>", "read the lyrics from a file instead")
    .option("--instrumental", "request an instrumental (no vocals) song")
    .option("--duration <seconds>", "requested length in seconds; recorded in metadata — Flow Music sets the song's length", parseIntegerOption)
    .option("--format <format>", "download format: m4a, mp3, or wav", (v) => {
      if (!MUSIC_DOWNLOAD_FORMATS.includes(v as (typeof MUSIC_DOWNLOAD_FORMATS)[number])) {
        throw new InvalidArgumentError(`must be one of: ${MUSIC_DOWNLOAD_FORMATS.join(", ")}`);
      }
      return v;
    }, "mp3")
    .option("--timeout <seconds>", "generation timeout in seconds", parseIntegerOption)
    .option("--out <path>", "output directory", "./gflow-output")
    .option("--profile <name>", "browser profile name", "default")
    .option("--browser <name>", "browser channel for Flow automation: chrome or chromium", parseBrowserOption, DEFAULT_BROWSER_CHANNEL)
    .option("--headed", "show browser", true)
    .option("--no-headed", "run browser headless")
    .action(async (command) => {
      // Parse before opening the browser: a bad duration or missing lyrics file fails here.
      const job = parseMusicJob({
        id: command.id,
        type: "music",
        prompt: command.prompt,
        style: command.style,
        lyrics: command.lyrics,
        lyricsFile: command.lyricsFile ? resolve(process.cwd(), command.lyricsFile) : undefined,
        instrumental: command.instrumental ?? false,
        duration: command.duration,
        timeout: command.timeout,
        out: command.out
      });
      const owned = options.musicAutomation
        ? { automation: options.musicAutomation, close: async () => undefined }
        : await realMusicAutomation(command.profile, command.headed, command.browser);
      try {
        const result = await owned.automation.runSong({
          ...job,
          outDir: resolveOutputDir(job.out),
          format: command.format
        });
        for (const artifact of result.artifacts) {
          console.log(`saved ${artifact.path}`);
        }
      } finally {
        await owned.close();
      }
    });

  program.configureOutput({
    writeErr: (text) => process.stderr.write(text)
  });

  return program;
}

/**
 * Execute one CLI invocation end to end: build the program (real automations),
 * parse `argv`, and map the outcome to a process exit code.
 *
 * @param argv the full argument vector as received by the process, including
 * the `node` runtime and script path (typically `process.argv`).
 * @returns the exit code — 0 on success, the command's own code for
 * help/version/invalid-argument, or a code derived from the thrown error
 * (login required 2, UI contract change 3, blocked generation 4, and so on).
 *
 * @example Use as the binary entrypoint
 * ```ts
 * import { runCli } from "@lechcher/gflow-cli";
 *
 * process.exitCode = await runCli(process.argv);
 * ```
 *
 * @example Drive it from a test
 * ```ts
 * import { runCli } from "@lechcher/gflow-cli";
 *
 * const code = await runCli(["node", "gflow", "doctor"]);
 * ```
 */
export async function runCli(argv: string[]): Promise<number> {
  const program = createProgram();
  try {
    await program.parseAsync(argv);
    return 0;
  } catch (error) {
    if (
      error instanceof CommanderError &&
      (error.code === "commander.helpDisplayed" || error.code === "commander.version" || error.code === "commander.invalidArgument")
    ) {
      return error.exitCode;
    }
    console.error(messageForError(error));
    return exitCodeForError(error);
  }
}
