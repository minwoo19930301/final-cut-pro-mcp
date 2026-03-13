#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import {
  createTitleProject,
  FinalCutError,
  getAppInfo,
  importFcpxml,
  inspectLibraries,
  openFinalCut,
  summarizeLibraries,
} from "./final-cut.js";

const server = new McpServer({
  name: "final-cut-pro-mcp",
  version: "0.1.0",
});

server.registerTool(
  "fcp_app_info",
  {
    title: "Final Cut Pro App Info",
    description: "Detect the locally installed Final Cut Pro app and return its version and scripting-definition path.",
    outputSchema: {
      appName: z.string(),
      bundleId: z.string(),
      appPath: z.string(),
      version: z.string(),
      scriptingDefinitionPath: z.string(),
    },
  },
  async () => {
    const app = await getAppInfo();

    return {
      content: [{ type: "text", text: JSON.stringify(app, null, 2) }],
      structuredContent: app,
    };
  },
);

server.registerTool(
  "fcp_open",
  {
    title: "Open Final Cut Pro",
    description: "Open Final Cut Pro on this Mac.",
    outputSchema: {
      opened: z.literal(true),
      app: z.object({
        appName: z.string(),
        bundleId: z.string(),
        appPath: z.string(),
        version: z.string(),
        scriptingDefinitionPath: z.string(),
      }),
    },
  },
  async () => {
    const result = await openFinalCut();

    return {
      content: [{ type: "text", text: `Opened ${result.app.appName}.` }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "fcp_list_libraries",
  {
    title: "List Final Cut Pro Libraries",
    description: "Read Final Cut Pro libraries, events, and projects through the app's Apple Events interface.",
    outputSchema: {
      app: z.object({
        appName: z.string(),
        bundleId: z.string(),
        appPath: z.string(),
        version: z.string(),
        scriptingDefinitionPath: z.string(),
      }),
      libraries: z.array(
        z.object({
          name: z.string().nullable(),
          id: z.string().nullable(),
          file: z.string().nullable(),
          events: z.array(
            z.object({
              name: z.string().nullable(),
              id: z.string().nullable(),
              projects: z.array(
                z.object({
                  name: z.string().nullable(),
                  id: z.string().nullable(),
                  sequence: z
                    .object({
                      name: z.string().nullable(),
                      id: z.string().nullable(),
                      startTime: z
                        .object({
                          value: z.number().nullable(),
                          timescale: z.number().nullable(),
                          epoch: z.number().nullable(),
                          flags: z.number().nullable(),
                        })
                        .nullable(),
                      duration: z
                        .object({
                          value: z.number().nullable(),
                          timescale: z.number().nullable(),
                          epoch: z.number().nullable(),
                          flags: z.number().nullable(),
                        })
                        .nullable(),
                      frameDuration: z
                        .object({
                          value: z.number().nullable(),
                          timescale: z.number().nullable(),
                          epoch: z.number().nullable(),
                          flags: z.number().nullable(),
                        })
                        .nullable(),
                      timecodeFormat: z.string().nullable(),
                    })
                    .nullable(),
                }),
              ),
            }),
          ),
        }),
      ),
    },
  },
  async () => {
    const result = await inspectLibraries();

    return {
      content: [{ type: "text", text: summarizeLibraries(result.libraries) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "fcp_create_title_project",
  {
    title: "Create Title Project",
    description: "Create a title-only Final Cut Pro project by generating FCPXML and importing it into a target library.",
    inputSchema: {
      text: z.string().describe("The title text to place on screen"),
      durationSeconds: z.number().positive().default(5).describe("Project duration in seconds"),
      libraryPath: z.string().optional().describe("Optional .fcpbundle path. Defaults to the newest library in ~/Movies"),
      eventName: z.string().optional().describe("Optional event name"),
      projectName: z.string().optional().describe("Optional project name"),
      effectPreset: z.enum(["basic", "zoom", "fade", "move"]).optional().describe("Optional built-in Final Cut title preset"),
      fontName: z.string().optional().describe("Optional font name"),
      fontSize: z.number().positive().optional().describe("Optional font size"),
      startScale: z.number().positive().optional().describe("Optional starting scale for the title animation"),
      endScale: z.number().positive().optional().describe("Optional ending scale for the title animation"),
    },
    outputSchema: {
      imported: z.literal(true),
      app: z.object({
        appName: z.string(),
        bundleId: z.string(),
        appPath: z.string(),
        version: z.string(),
        scriptingDefinitionPath: z.string(),
      }),
      libraryPath: z.string(),
      eventName: z.string(),
      projectName: z.string(),
      eventPath: z.string(),
      projectPath: z.string(),
      durationSeconds: z.number(),
      text: z.string(),
      fcpxmlPath: z.string(),
      effectPreset: z.enum(["basic", "zoom", "fade", "move"]),
      startScale: z.number(),
      endScale: z.number(),
    },
  },
  async ({ text, durationSeconds, libraryPath, eventName, projectName, effectPreset, fontName, fontSize, startScale, endScale }) => {
    const result = await createTitleProject({
      text,
      durationSeconds,
      libraryPath,
      eventName,
      projectName,
      effectPreset,
      fontName,
      fontSize,
      startScale,
      endScale,
    });

    return {
      content: [
        {
          type: "text",
          text: `Created project "${result.projectName}" in event "${result.eventName}" with title "${result.text}".`,
        },
      ],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "fcp_import_fcpxml",
  {
    title: "Import FCPXML",
    description: "Import an FCPXML file by opening it with Final Cut Pro.",
    inputSchema: {
      path: z.string().describe("Absolute or relative path to the FCPXML file"),
    },
    outputSchema: {
      imported: z.literal(true),
      app: z.object({
        appName: z.string(),
        bundleId: z.string(),
        appPath: z.string(),
        version: z.string(),
        scriptingDefinitionPath: z.string(),
      }),
      inputPath: z.string(),
    },
  },
  async ({ path }) => {
    const result = await importFcpxml(path);

    return {
      content: [{ type: "text", text: `Imported ${result.inputPath} into ${result.app.appName}.` }],
      structuredContent: result,
    };
  },
);

async function main(): Promise<void> {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("final-cut-pro-mcp is running on stdio");
  } catch (error) {
    if (error instanceof FinalCutError) {
      console.error(error.message);
      process.exit(1);
    }

    console.error(error);
    process.exit(1);
  }
}

main();
