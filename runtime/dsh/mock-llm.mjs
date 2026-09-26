// Keyless test adapter only. The production profile does not load this file.
// The DSH module path is supplied by the pinned, locally built Harness clone.
const llmModule = process.env.TELEPATHY_DSH_LLM_MODULE;
if (!llmModule) throw new Error('TELEPATHY_DSH_LLM_MODULE is required for the keyless smoke adapter');
const { LlmAdapter, ToolCallId, ReasoningEffortId } = await import(llmModule);

class AlgorithmMockAdapter extends LlmAdapter {
  async resolveModel(provider, model) {
    return { provider, id: model, name: model,
      reasoning: { efforts: [{ id: ReasoningEffortId('off'), name: 'Off' }],
        defaultEffort: ReasoningEffortId('off') } };
  }

  async *stream(options) {
    const last = options.messages.at(-1);
    const toolText = last?.role === 'tool' ? last.content.filter(block => block.type === 'text').map(block => block.text).join('') : '';
    let call;
    let answer;
    if (!toolText) {
      call = process.env.TELEPATHY_DSH_MOCK_COMPILE_SOURCE
        ? { name: 'algorithm_compile', id: 'algorithm-compile-smoke',
          args: { source_text: process.env.TELEPATHY_DSH_MOCK_COMPILE_SOURCE } }
        : { name: 'algorithm_active', id: 'algorithm-active-smoke', args: {} };
    } else {
      let result;
      try { result = JSON.parse(toolText); } catch { result = {}; }
      if (process.env.TELEPATHY_DSH_MOCK_COMPILE_SOURCE && Object.hasOwn(result, 'ok')) {
        answer = `Algorithm compilation complete: ${result.bend_sha256 ?? 'diagnostics'}`;
      } else if (result.session_id && Object.hasOwn(result, 'active')) {
        let args;
        try { args = JSON.parse(process.env.TELEPATHY_DSH_MOCK_CASE_ARGS ?? '["batch","1"]'); } catch { args = ['batch', '1']; }
        if (process.env.TELEPATHY_DSH_MOCK_EXECUTE === '1') {
          call = { name: 'algorithm_execute', id: 'algorithm-execute-smoke', args: { args } };
        } else {
          call = { name: 'algorithm_run', id: 'algorithm-run-smoke', args: {
            source: process.env.TELEPATHY_DSH_MOCK_SOURCE,
            source_sha256: process.env.TELEPATHY_DSH_MOCK_SOURCE_SHA256,
            predict_check_pass: true, predict_build_pass: true,
            cases: [{ name: 'explore', args,
              predicted_stdout: process.env.TELEPATHY_DSH_MOCK_PREDICTED_STDOUT ?? 'clock=1;value=3\n' }],
          } };
        }
      } else if (result.receipt_id && result.receipt_sha256) {
        call = { name: 'algorithm_score', id: 'algorithm-score-smoke',
          args: { receipt_id: result.receipt_id, receipt_sha256: result.receipt_sha256 } };
      } else if (result.score_sha256 && process.env.TELEPATHY_DSH_MOCK_SELECT === '1') {
        call = { name: 'algorithm_select', id: 'algorithm-select-smoke', args: {
          candidate_score_sha256: result.score_sha256,
          incumbent_score_sha256: process.env.TELEPATHY_DSH_MOCK_INCUMBENT_SHA256 ?? null,
          expected_active_score_sha256: null,
        } };
      } else {
        answer = `Algorithm cycle complete: ${toolText.slice(0, 512)}`;
      }
    }
    if (call) {
      const args = JSON.stringify(call.args);
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index: 0, id: ToolCallId(call.id), name: call.name, argumentsDelta: args };
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(call.id), name: call.name, arguments: args } };
      yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 2 } };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: answer };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } };
      yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
}

export const name = 'telepathy-algorithm-mock-llm';
export const inject = ['llm'];
export function apply(ctx) { ctx.llm.registerAdapter(['telepathy-mock'], new AlgorithmMockAdapter()); }
