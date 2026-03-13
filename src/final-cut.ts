import { access, mkdtemp, readdir, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 10_000;

export type TitleEffectPreset = "basic" | "zoom" | "fade" | "move";

const TITLE_EFFECTS: Record<TitleEffectPreset, { name: string; uid: string; usesTransform: boolean }> = {
  basic: {
    name: "Basic Title",
    uid: ".../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.moti",
    usesTransform: true,
  },
  zoom: {
    name: "Zoom",
    uid: ".../Titles.localized/Build In:Out.localized/Zoom.localized/Zoom.moti",
    usesTransform: false,
  },
  fade: {
    name: "Fade",
    uid: ".../Titles.localized/Build In:Out.localized/Fade.localized/Fade.moti",
    usesTransform: false,
  },
  move: {
    name: "Move",
    uid: ".../Titles.localized/Build In:Out.localized/Move.localized/Move.moti",
    usesTransform: false,
  },
};

const FINAL_CUT_VARIANTS = [
  {
    appName: "Final Cut Pro",
    bundleId: "com.apple.FinalCut",
    appPath: "/Applications/Final Cut Pro.app",
  },
  {
    appName: "Final Cut Pro Trial",
    bundleId: "com.apple.FinalCutTrial",
    appPath: "/Applications/Final Cut Pro Trial.app",
  },
] as const;

export type FinalCutVariant = (typeof FINAL_CUT_VARIANTS)[number];

export type MediaTime = {
  value: number | null;
  timescale: number | null;
  epoch: number | null;
  flags: number | null;
};

export type SequenceSummary = {
  name: string | null;
  id: string | null;
  startTime: MediaTime | null;
  duration: MediaTime | null;
  frameDuration: MediaTime | null;
  timecodeFormat: string | null;
};

export type ProjectSummary = {
  name: string | null;
  id: string | null;
  sequence: SequenceSummary | null;
};

export type EventSummary = {
  name: string | null;
  id: string | null;
  projects: ProjectSummary[];
};

export type LibrarySummary = {
  name: string | null;
  id: string | null;
  file: string | null;
  events: EventSummary[];
};

export type AppInfo = {
  appName: string;
  bundleId: string;
  appPath: string;
  version: string;
  scriptingDefinitionPath: string;
};

export type CreateTitleProjectOptions = {
  text: string;
  durationSeconds?: number;
  libraryPath?: string;
  eventName?: string;
  projectName?: string;
  effectPreset?: TitleEffectPreset | string;
  fontName?: string;
  fontSize?: number;
  startScale?: number;
  endScale?: number;
};

export type CreatedTitleProject = {
  imported: true;
  app: AppInfo;
  libraryPath: string;
  eventName: string;
  projectName: string;
  eventPath: string;
  projectPath: string;
  durationSeconds: number;
  text: string;
  fcpxmlPath: string;
  effectPreset: TitleEffectPreset;
  startScale: number;
  endScale: number;
};

export class FinalCutError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FinalCutError";
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function detectFinalCutApp(): Promise<FinalCutVariant | null> {
  for (const variant of FINAL_CUT_VARIANTS) {
    if (await exists(variant.appPath)) {
      return variant;
    }
  }

  return null;
}

async function execTextFile(command: string, args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf8",
    });
    return stdout.trim();
  } catch (error) {
    if (typeof error === "object" && error && "killed" in error && error.killed) {
      throw new FinalCutError(
        "Final Cut Pro did not respond in time. Open the app and allow Automation access, then try again.",
        { cause: error },
      );
    }

    throw error;
  }
}

async function runJxa<T>(script: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const raw = await execTextFile("osascript", ["-l", "JavaScript", "-e", script], timeoutMs);

  if (!raw) {
    throw new FinalCutError("Final Cut Pro automation returned no output.");
  }

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new FinalCutError(`Failed to parse Final Cut Pro response: ${raw}`, { cause: error });
  }
}

function escapeForJxa(value: string): string {
  return JSON.stringify(value);
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function normalizeName(value: string | undefined, fallback: string): string {
  const normalized = (value ?? fallback)
    .replace(/[/:]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || fallback;
}

function normalizeEffectPreset(value: string | undefined): TitleEffectPreset {
  switch (value?.trim().toLowerCase()) {
    case undefined:
    case "":
    case "basic":
      return "basic";
    case "zoom":
      return "zoom";
    case "fade":
      return "fade";
    case "move":
      return "move";
    default:
      throw new FinalCutError(`Unknown effect preset: ${value}. Supported values: basic, zoom, fade, move.`);
  }
}

function fileStem(value: string): string {
  const stem = value
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return stem || "final-cut-project";
}

function timestampSlug(): string {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

async function findDefaultLibraryPath(): Promise<string> {
  const moviesDir = join(homedir(), "Movies");
  const entries = await readdir(moviesDir, { withFileTypes: true }).catch(() => []);
  const libraries: Array<{ path: string; mtimeMs: number }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith(".fcpbundle")) {
      continue;
    }

    const path = join(moviesDir, entry.name);
    const metadata = await stat(path);
    libraries.push({ path, mtimeMs: metadata.mtimeMs });
  }

  libraries.sort((left, right) => right.mtimeMs - left.mtimeMs);

  if (libraries.length === 0) {
    throw new FinalCutError("No Final Cut Pro library was found in ~/Movies. Create a library once or pass --library.");
  }

  return libraries[0].path;
}

async function resolveLibraryPath(libraryPath?: string): Promise<string> {
  const targetPath = libraryPath ? resolve(libraryPath) : await findDefaultLibraryPath();

  if (!(await exists(targetPath))) {
    throw new FinalCutError(`Final Cut Pro library not found: ${targetPath}`);
  }

  if (!targetPath.endsWith(".fcpbundle")) {
    throw new FinalCutError(`Expected a .fcpbundle library path, received: ${targetPath}`);
  }

  return targetPath;
}

async function uniqueEventName(libraryPath: string, baseName: string): Promise<string> {
  let attempt = baseName;
  let counter = 2;

  while (await exists(join(libraryPath, attempt))) {
    attempt = `${baseName} ${counter}`;
    counter += 1;
  }

  return attempt;
}

async function uniqueProjectName(libraryPath: string, eventName: string, baseName: string): Promise<string> {
  const eventPath = join(libraryPath, eventName);
  if (!(await exists(eventPath))) {
    return baseName;
  }

  let attempt = baseName;
  let counter = 2;

  while (await exists(join(eventPath, attempt))) {
    attempt = `${baseName} ${counter}`;
    counter += 1;
  }

  return attempt;
}

async function projectExists(libraryPath: string, eventName: string, projectName: string): Promise<boolean> {
  return exists(join(libraryPath, eventName, projectName));
}

function buildTitleProjectFcpxml(options: {
  libraryPath: string;
  eventName: string;
  projectName: string;
  text: string;
  durationSeconds: number;
  effectPreset: TitleEffectPreset;
  fontName: string;
  fontSize: number;
  startScale: number;
  endScale: number;
}): string {
  const effect = TITLE_EFFECTS[options.effectPreset];
  const libraryUrl = pathToFileURL(options.libraryPath).href;
  const duration = `${options.durationSeconds}s`;
  const startScale = `${options.startScale} ${options.startScale}`;
  const endScale = `${options.endScale} ${options.endScale}`;
  const transformBlock = effect.usesTransform
    ? `
            <adjust-transform scale="${startScale}">
              <param name="Scale" key="scale" value="${startScale}">
                <keyframeAnimation>
                  <keyframe time="0s" value="${startScale}"/>
                  <keyframe time="${duration}" value="${endScale}"/>
                </keyframeAnimation>
              </param>
            </adjust-transform>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.13">
  <import-options>
    <option key="library location" value="${xmlEscape(libraryUrl)}"/>
    <option key="suppress warnings" value="1"/>
  </import-options>
  <resources>
    <format id="r1" name="FFVideoFormat1080p30" frameDuration="1/30s" width="1920" height="1080" colorSpace="1-1-1 (Rec. 709)"/>
    <effect id="r2" name="${xmlEscape(effect.name)}" uid="${xmlEscape(effect.uid)}"/>
  </resources>
  <event name="${xmlEscape(options.eventName)}">
    <project name="${xmlEscape(options.projectName)}">
      <sequence format="r1" duration="${duration}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
        <spine>
          <title name="Start Title" offset="0s" ref="r2" duration="${duration}" start="0s">
            <param name="Position" key="9999/10199/10201/1/100/101" value="0 0"/>
            <text>
              <text-style ref="ts1">${xmlEscape(options.text)}</text-style>
            </text>
            <text-style-def id="ts1">
              <text-style font="${xmlEscape(options.fontName)}" fontSize="${options.fontSize}" fontFace="Regular" fontColor="1 1 1 1" alignment="center"/>
            </text-style-def>
${transformBlock}
          </title>
        </spine>
      </sequence>
    </project>
  </event>
</fcpxml>
`;
}

async function waitForPath(path: string, timeoutMs = 20_000): Promise<boolean> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await exists(path)) {
      return true;
    }

    await new Promise((resolvePromise) => {
      setTimeout(resolvePromise, 500);
    });
  }

  return false;
}

export async function getAppInfo(): Promise<AppInfo> {
  const variant = await detectFinalCutApp();
  if (!variant) {
    throw new FinalCutError("Final Cut Pro is not installed in /Applications.");
  }

  const version = await execTextFile("mdls", ["-raw", "-name", "kMDItemVersion", variant.appPath], 4_000);
  const scriptingDefinitionPath = `${variant.appPath}/Contents/Resources/ProEditor.sdef`;

  return {
    appName: variant.appName,
    bundleId: variant.bundleId,
    appPath: variant.appPath,
    version,
    scriptingDefinitionPath,
  };
}

export async function openFinalCut(): Promise<{ opened: true; app: AppInfo }> {
  const app = await getAppInfo();
  await execTextFile("open", ["-a", app.appPath], 8_000);
  return { opened: true, app };
}

export async function importFcpxml(inputPath: string): Promise<{
  imported: true;
  app: AppInfo;
  inputPath: string;
}> {
  const app = await getAppInfo();
  const absolutePath = resolve(inputPath);

  if (!(await exists(absolutePath))) {
    throw new FinalCutError(`FCPXML file not found: ${absolutePath}`);
  }

  await execTextFile("open", ["-a", app.appPath, absolutePath], 8_000);

  return {
    imported: true,
    app,
    inputPath: absolutePath,
  };
}

export async function createTitleProject(options: CreateTitleProjectOptions): Promise<CreatedTitleProject> {
  const text = options.text.trim();
  if (!text) {
    throw new FinalCutError("Text is required to create a title project.");
  }

  const durationSeconds = options.durationSeconds ?? 5;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new FinalCutError("durationSeconds must be a positive number.");
  }

  const app = await getAppInfo();
  const libraryPath = await resolveLibraryPath(options.libraryPath);
  const eventBaseName = normalizeName(options.eventName, `AI Event ${timestampSlug()}`);
  const projectBaseName = normalizeName(options.projectName, `AI Title ${timestampSlug()}`);
  const eventRequested = options.eventName !== undefined;
  const projectRequested = options.projectName !== undefined;
  const eventName = eventRequested ? eventBaseName : await uniqueEventName(libraryPath, eventBaseName);
  const projectName = projectRequested ? projectBaseName : await uniqueProjectName(libraryPath, eventName, projectBaseName);

  if (eventRequested && projectRequested && (await projectExists(libraryPath, eventName, projectName))) {
    throw new FinalCutError(
      `Project already exists: ${join(libraryPath, eventName, projectName)}. Reuse it or delete it before creating the same named project again.`,
    );
  }

  const effectPreset = normalizeEffectPreset(options.effectPreset);
  const fontName = normalizeName(options.fontName, "Helvetica");
  const fontSize = options.fontSize ?? 96;
  const startScale = options.startScale ?? 0.8;
  const endScale = options.endScale ?? 1.2;

  const tempDirectory = await mkdtemp(join(tmpdir(), "final-cut-pro-mcp-"));
  const fcpxmlPath = join(tempDirectory, `${fileStem(projectName)}.fcpxml`);
  const fcpxml = buildTitleProjectFcpxml({
    libraryPath,
    eventName,
    projectName,
    text,
    durationSeconds,
    effectPreset,
    fontName,
    fontSize,
    startScale,
    endScale,
  });

  await writeFile(fcpxmlPath, fcpxml, "utf8");
  await execTextFile("open", ["-a", app.appPath], 8_000);
  await importFcpxml(fcpxmlPath);

  const eventPath = join(libraryPath, eventName);
  const projectPath = join(eventPath, projectName);

  const created = await waitForPath(projectPath);
  if (!created) {
    throw new FinalCutError(
      `Final Cut Pro import started but the created project was not detected in ${libraryPath}. Check the app for an import error dialog.`,
    );
  }

  return {
    imported: true,
    app,
    libraryPath,
    eventName,
    projectName,
    eventPath,
    projectPath,
    durationSeconds,
    text,
    fcpxmlPath,
    effectPreset,
    startScale,
    endScale,
  };
}

export async function inspectLibraries(): Promise<{
  app: AppInfo;
  libraries: LibrarySummary[];
}> {
  const app = await getAppInfo();
  const response = await runJxa<{
    ok: true;
    libraries: LibrarySummary[];
  } | {
    ok: false;
    error: string;
  }>(
    `
const app = Application(${escapeForJxa(app.appName)});

function safe(fn, fallback = null) {
  try {
    const value = fn();
    return value === undefined ? fallback : value;
  } catch (_error) {
    return fallback;
  }
}

function mediaTime(value) {
  if (!value) {
    return null;
  }

  return {
    value: safe(() => value.value(), null),
    timescale: safe(() => value.timescale(), null),
    epoch: safe(() => value.epoch(), null),
    flags: safe(() => value.flags(), null),
  };
}

function sequence(sequenceRef) {
  if (!sequenceRef) {
    return null;
  }

  return {
    name: safe(() => sequenceRef.name(), null),
    id: safe(() => sequenceRef.id(), null),
    startTime: mediaTime(safe(() => sequenceRef.startTime(), null)),
    duration: mediaTime(safe(() => sequenceRef.duration(), null)),
    frameDuration: mediaTime(safe(() => sequenceRef.frameDuration(), null)),
    timecodeFormat: safe(() => sequenceRef.timecodeFormat().toString(), null),
  };
}

function project(projectRef) {
  return {
    name: safe(() => projectRef.name(), null),
    id: safe(() => projectRef.id(), null),
    sequence: sequence(safe(() => projectRef.sequence(), null)),
  };
}

function eventRecord(eventRef) {
  return {
    name: safe(() => eventRef.name(), null),
    id: safe(() => eventRef.id(), null),
    projects: safe(() => eventRef.projects().map(project), []),
  };
}

function library(libraryRef) {
  return {
    name: safe(() => libraryRef.name(), null),
    id: safe(() => libraryRef.id(), null),
    file: safe(() => libraryRef.file().toString(), null),
    events: safe(() => libraryRef.events().map(eventRecord), []),
  };
}

try {
  JSON.stringify({
    ok: true,
    libraries: app.libraries().map(library),
  });
} catch (error) {
  JSON.stringify({
    ok: false,
    error: error.toString(),
  });
}
    `,
  );

  if (!response.ok) {
    throw new FinalCutError(
      `Final Cut Pro automation failed: ${response.error}. Ensure the app is open and Automation permission is allowed.`,
    );
  }

  return {
    app,
    libraries: response.libraries,
  };
}

export function summarizeLibraries(libraries: LibrarySummary[]): string {
  if (libraries.length === 0) {
    return "No libraries were returned by Final Cut Pro.";
  }

  return libraries
    .map((library) => {
      const eventCount = library.events.length;
      const projectCount = library.events.reduce((count, event) => count + event.projects.length, 0);
      return `${library.name ?? "(unnamed library)"}: ${eventCount} event(s), ${projectCount} project(s)`;
    })
    .join("\n");
}
