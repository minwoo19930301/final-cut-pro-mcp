#!/usr/bin/env node

import {
  createTitleProject,
  FinalCutError,
  getAppInfo,
  importFcpxml,
  inspectLibraries,
  openFinalCut,
  summarizeLibraries,
} from "./final-cut.js";

function usage(): string {
  return `
fcp-cli <command> [options]

Commands:
  app-info                 Show the detected Final Cut Pro app
  open                     Open Final Cut Pro
  list-libraries [--json]  Read libraries, events, and projects via Apple Events
  import-fcpxml <path>     Import an FCPXML file by opening it with Final Cut Pro
  create-title-project     Create a 5-second title-only project in Final Cut Pro
  help                     Show this help text
  `.trim();
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
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
