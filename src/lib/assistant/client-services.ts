import { AppError, type ActionResult } from "@/lib/errors";
import {
  acceptAssistantProposal,
  clearAssistantFeedback,
  editAssistantProposal,
  getAssistantHiddenRules,
  setAssistantFeedback,
  setAssistantRuleHidden,
  getAssistantProposals,
  markAssistantProposalViewed,
  rejectAssistantProposal,
  runAssistantAnalysis,
} from "./actions";
import type { AssistantServices } from "./types";

/**
 * Browser-side AssistantServices over the Server Actions. It unwraps ActionResult and throws
 * AppError so the UI handles failures the same way it handles every other service.
 */
function unwrap<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new AppError(result.code, result.message);
  return result.data;
}

export function createAssistantServices(boardId: string): AssistantServices {
  return {
    async run(request) {
      return unwrap(await runAssistantAnalysis({ boardId, ...request }));
    },
    async list() {
      return unwrap(await getAssistantProposals({ boardId }));
    },
    async markViewed(proposalId) {
      unwrap(await markAssistantProposalViewed({ boardId, proposalId }));
    },
    async edit(proposalId, proposal) {
      return unwrap(await editAssistantProposal({ boardId, proposalId, proposal }));
    },
    async reject(proposalId) {
      return unwrap(await rejectAssistantProposal({ boardId, proposalId }));
    },
    async accept(proposalId) {
      return unwrap(await acceptAssistantProposal({ boardId, proposalId }));
    },
    async setFeedback(proposalId, feedback) {
      return unwrap(await setAssistantFeedback({ boardId, proposalId, ...feedback }));
    },
    async clearFeedback(proposalId) {
      unwrap(await clearAssistantFeedback({ boardId, proposalId }));
    },
    async setRuleHidden(ruleId, hidden) {
      unwrap(await setAssistantRuleHidden({ boardId, ruleId, hidden }));
    },
    async hiddenRules() {
      return unwrap(await getAssistantHiddenRules({ boardId }));
    },
  };
}
