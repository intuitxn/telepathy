import { z } from "zod";
export type ToolResult = { title: string; output: string; metadata: Record<string, unknown> };
export function tool<S extends z.ZodRawShape>(definition: {
  description: string; args: S; execute: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResult>;
}) { return definition; }
