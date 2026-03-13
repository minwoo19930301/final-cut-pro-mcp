#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createStoryboardProject,
  createTitleProject,
  FinalCutError,
  getAppInfo,
  importFcpxml,
  inspectLibraries,
  openFinalCut,
  runDoctor,
  summarizeLibraries,
} from "./final-cut.js";
import type { StoryboardSegmentInput } from "./final-cut.js";

function usage(): string {
  return `
fcp-cli <command> [options]

Commands:
  app-info                         Show the detected Final Cut Pro app
  open                             Open Final Cut Pro
  doctor [--json]                  Run environment and automation diagnostics
  list-libraries [--json]          Read libraries, events, and projects via Apple Events
  import-fcpxml <path>             Import an FCPXML file by opening it with Final Cut Pro
  create-title-project             Create a title-only project in Final Cut Pro
  create-storyboard-project        Create a multi-segment storyboard project
  help                             Show this help text

Examples:
  fcp-cli doctor --json
  fcp-cli create-title-project --text 시작 --seconds 5 --effect zoom
  fcp-cli create-storyboard-project --segments "시작|2|zoom;핵심|2|move;마무리|1|fade"
  fcp-cli create-storyboard-project --segments-file ./story.json
  `.trim();
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function parseInlineSegments(raw: string): StoryboardSegmentInput[] {
  const chunks = raw
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (chunks.length === 0) {
    throw new FinalCutError("No storyboard segments were found in --segments.");
  }

  return chunks.map((chunk, index) => {
    const [textRaw = "", secondsRaw = "", effectRaw = ""] = chunk.split("|");
    const text = textRaw.trim();
    if (!text) {
      throw new FinalCutError(`Segment ${index + 1} has empty text in --segments.`);
    }

    const durationSeconds = secondsRaw.trim() ? Number(secondsRaw.trim()) : 2;
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new FinalCutError(`Segment ${index + 1} has invalid duration: ${secondsRaw}`);
    }

    return {
      text,
      durationSeconds,
      effectPreset: effectRaw.trim() || undefined,
    };
  });
}

async function loadSegmentsFromFile(pathValue: string): Promise<StoryboardSegmentInput[]> {
  const absolutePath = resolve(pathValue);
  const raw = await readFile(absolutePath, "utf8");

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (error) {
    throw new FinalCutError(`Failed to parse JSON: ${absolutePath}`, { cause: error });
  }

  const source =
    Array.isArray(decoded)
      ? decoded
      : typeof decoded === "object" && decoded !== null && Array.isArray((decoded as { segments?: unknown }).segments)
        ? (decoded as { segments: unknown[] }).segments
        : null;

  if (!source) {
    throw new FinalCutError(`Expected an array or { segments: [...] } in ${absolutePath}`);
  }

  if (source.length === 0) {
    throw new FinalCutError(`No segments found in ${absolutePath}`);
  }

  return source.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new FinalCutError(`segments[${index}] must be an object in ${absolutePath}`);
    }

    const value = item as Record<string, unknown>;
    const textValue = typeof value.text === "string" ? value.text : "";
    const durationValue = typeof value.durationSeconds === "number"
      ? value.durationSeconds
      : typeof value.seconds === "number"
        ? value.seconds
        : undefined;
    const effectValue = typeof value.effectPreset === "string"
      ? value.effectPreset
      : typeof value.effect === "string"
        ? value.effect
        : undefined;
    const fontNameValue = typeof value.fontName === "string"
      ? value.fontName
      : typeof value.font === "string"
        ? value.font
        : undefined;
    const fontSizeValue = typeof value.fontSize === "number" ? value.fontSize : undefined;
    const startScaleValue = typeof value.startScale === "number" ? value.startScale : undefined;
    const endScaleValue = typeof value.endScale === "number" ? value.endScale : undefined;
    const positionXValue = typeof value.positionX === "number"
      ? value.positionX
      : typeof value.x === "number"
        ? value.x
        : undefined;
    const positionYValue = typeof value.positionY === "number"
      ? value.positionY
      : typeof value.y === "number"
        ? value.y
        : undefined;

    if (!textValue.trim()) {
      throw new FinalCutError(`segments[${index}].text is required in ${absolutePath}`);
    }

    return {
      text: textValue,
      durationSeconds: durationValue ?? 2,
      effectPreset: effectValue,
      fontName: fontNameValue,
      fontSize: fontSizeValue,
      startScale: startScaleValue,
      endScale: endScaleValue,
      positionX: positionXValue,
      positionY: positionYValue,
    };
  });
}

async function main(): Promise<void> {
  const [, , command = "help", ...rest] = process.argv;
  const json = rest.includes("--json");

  switch (command) {
    case "help":
    case "--help":
    case "-h": {
      console.log(usage());
      return;
    }

    case "app-info": {
      const app = await getAppInfo();
      console.log(JSON.stringify(app, null, 2));
      return;
    }

    case "open": {
      const result = await openFinalCut();
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    case "doctor": {
      const libraryPath = readOption(rest, "--library");
      const report = await runDoctor({ libraryPath });
      if (json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`allOk: ${report.allOk}`);
        for (const check of report.checks) {
          console.log(`${check.ok ? "OK" : "FAIL"} ${check.key}: ${check.detail}`);
        }
      }
      return;
    }

    case "list-libraries": {
      const result = await inspectLibraries();
      if (json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`${result.app.appName} ${result.app.version}`);
        console.log(summarizeLibraries(result.libraries));
      }
      return;
    }

    case "import-fcpxml": {
      const targetPath = rest.find((value) => !value.startsWith("-"));
      if (!targetPath) {
        throw new FinalCutError("Usage: fcp-cli import-fcpxml <path>");
      }

      const result = await importFcpxml(targetPath);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    case "create-title-project": {
      const text = readOption(rest, "--text") ?? "시작";
      const secondsRaw = readOption(rest, "--seconds");
      const durationSeconds = secondsRaw ? Number(secondsRaw) : 5;
      const libraryPath = readOption(rest, "--library");
      const eventName = readOption(rest, "--event");
      const projectName = readOption(rest, "--project");
      const effectPreset = readOption(rest, "--effect");
      const startScaleRaw = readOption(rest, "--start-scale");
      const endScaleRaw = readOption(rest, "--end-scale");

      const result = await createTitleProject({
        text,
        durationSeconds,
        libraryPath,
        eventName,
        projectName,
        effectPreset,
        startScale: startScaleRaw ? Number(startScaleRaw) : undefined,
        endScale: endScaleRaw ? Number(endScaleRaw) : undefined,
      });

      console.log(JSON.stringify(result, null, 2));
      return;
    }

    case "create-storyboard-project": {
      const libraryPath = readOption(rest, "--library");
      const eventName = readOption(rest, "--event");
      const projectName = readOption(rest, "--project");
      const defaultFontName = readOption(rest, "--font");
      const fontSizeRaw = readOption(rest, "--font-size");
      const segmentsInline = readOption(rest, "--segments");
      const segmentsFile = readOption(rest, "--segments-file");

      const segments =
        segmentsInline
          ? parseInlineSegments(segmentsInline)
          : segmentsFile
            ? await loadSegmentsFromFile(segmentsFile)
            : [
                { text: "시작", durationSeconds: 2, effectPreset: "zoom" },
                { text: "핵심", durationSeconds: 2, effectPreset: "move" },
                { text: "마무리", durationSeconds: 1, effectPreset: "fade" },
              ];

      const result = await createStoryboardProject({
        segments,
        libraryPath,
        eventName,
        projectName,
        defaultFontName,
        defaultFontSize: fontSizeRaw ? Number(fontSizeRaw) : undefined,
      });

      console.log(JSON.stringify(result, null, 2));
      return;
    }

    default:
      throw new FinalCutError(`Unknown command: ${command}\n\n${usage()}`);
  }
}

main().catch((error) => {
  if (error instanceof FinalCutError) {
    console.error(error.message);
    process.exit(1);
  }

  console.error(error);
  process.exit(1);
});
