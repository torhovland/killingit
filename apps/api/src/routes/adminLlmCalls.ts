import {
  llmCallDetailSchema,
  llmCallsResponseSchema,
  llmModelRemarksResponseSchema,
  type LlmCallDetail,
  type LlmCallSummary,
  type LlmModelRemark,
} from "@killingit/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import {
  getLlmCall,
  listLlmCalls,
  listModelRemarks,
} from "../llm/callStore.js";

export interface AdminLlmCallsDependencies {
  /** Injectable for route tests; defaults to the database-backed store. */
  listCalls?: (limit: number, offset: number) => Promise<LlmCallSummary[]>;
  getCall?: (id: number) => Promise<LlmCallDetail | null>;
  /** Injectable for route tests; defaults to the database-backed store. */
  listRemarks?: (limit: number) => Promise<LlmModelRemark[]>;
}

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const remarksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/**
 * Admin-only prompt log. Listing omits the prompt and response bodies so the
 * page loads quickly; the detail endpoint returns one full call with the exact
 * messages, response, token usage, and request metadata.
 */
export function createAdminLlmCallsRoute(
  deps: AdminLlmCallsDependencies = {},
): Hono {
  const list = deps.listCalls ?? listLlmCalls;
  const get = deps.getCall ?? getLlmCall;
  const listRemarks = deps.listRemarks ?? listModelRemarks;

  return new Hono()
    .get("/", zValidator("query", listQuerySchema), async (c) => {
      const { limit, offset } = c.req.valid("query");
      const calls = await list(limit, offset);
      return c.json(llmCallsResponseSchema.parse({ calls }));
    })
    .get("/remarks", zValidator("query", remarksQuerySchema), async (c) => {
      const { limit } = c.req.valid("query");
      const remarks = await listRemarks(limit);
      return c.json(llmModelRemarksResponseSchema.parse({ remarks }));
    })
    .get("/:id", zValidator("param", idParamSchema), async (c) => {
      const { id } = c.req.valid("param");
      const call = await get(id);
      if (call === null) {
        return c.text("LLM call not found", 404);
      }
      return c.json(llmCallDetailSchema.parse(call));
    });
}
