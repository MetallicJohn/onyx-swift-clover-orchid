import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  assistantPermission,
  loadAssistantDesk,
  MCP_IMAGE,
  mcpGatewayStatus,
  runAssistantAsk,
  setRouterAiEnabled,
  setRouterAiWriteEnabled,
} from "./mikrotik-mcp";
import { approveChangePlan, cancelChangePlan, createRollbackPlan, listChangePlans } from "./mikrotik-plans";
import { assertFeature } from "./plans";
import { assertPermission } from "./rbac";
import { requireWorkspace as requireWs } from "./workspace";

export const getMikrotikAssistantFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "network.ai.view");
    await assertFeature(sql, tenantId, "ai_assistant");
    const mcp = await mcpGatewayStatus();
    return {
      routers: await loadAssistantDesk(sql, tenantId),
      plans: await listChangePlans(sql, tenantId),
      mcp: { status: mcp.status },
      pinned: MCP_IMAGE,
      canChat: assistantPermission(role, "chat"),
      canDiagnose: assistantPermission(role, "diagnose"),
      canPlan: assistantPermission(role, "plan"),
      canApprove: assistantPermission(role, "approve") && assistantPermission(role, "execute"),
      canRollback: assistantPermission(role, "rollback"),
      canEnable: assistantPermission(role, "enable"),
    };
  });

export const setMikrotikAssistantEnabledFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { router_id?: string; enabled?: boolean }) => ({
    router_id: String(d?.router_id || ""),
    enabled: d?.enabled === true,
  }))
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.manage");
    await assertFeature(sql, tenantId, "ai_assistant");
    return setRouterAiEnabled(sql, tenantId, data.router_id, data.enabled);
  });

export const setMikrotikAssistantWriteFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { router_id?: string; enabled?: boolean }) => ({
    router_id: String(d?.router_id || ""),
    enabled: d?.enabled === true,
  }))
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.manage");
    await assertFeature(sql, tenantId, "ai_assistant");
    return setRouterAiWriteEnabled(sql, tenantId, data.router_id, data.enabled);
  });

export const askMikrotikAssistantFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { router_id?: string; prompt?: string; conversation_id?: string }) => ({
    router_id: String(d?.router_id || ""),
    prompt: String(d?.prompt || ""),
    conversation_id: String(d?.conversation_id || ""),
  }))
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "network.ai.chat");
    await assertFeature(sql, tenantId, "ai_assistant");
    return runAssistantAsk(sql, {
      tenantId,
      userId: context.userId,
      role,
      routerId: data.router_id,
      prompt: data.prompt,
      conversationId: data.conversation_id || undefined,
    });
  });

export const approveMikrotikPlanFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { plan_id?: string }) => ({ plan_id: String(d?.plan_id || "") }))
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "network.ai.approve");
    await assertFeature(sql, tenantId, "ai_assistant");
    return approveChangePlan(sql, { tenantId, userId: context.userId, role, planId: data.plan_id });
  });

export const cancelMikrotikPlanFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { plan_id?: string }) => ({ plan_id: String(d?.plan_id || "") }))
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "network.ai.plan");
    await assertFeature(sql, tenantId, "ai_assistant");
    return cancelChangePlan(sql, { tenantId, role, planId: data.plan_id });
  });

export const rollbackMikrotikPlanFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { plan_id?: string }) => ({ plan_id: String(d?.plan_id || "") }))
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "network.ai.rollback");
    await assertFeature(sql, tenantId, "ai_assistant");
    return createRollbackPlan(sql, { tenantId, userId: context.userId, role, planId: data.plan_id });
  });