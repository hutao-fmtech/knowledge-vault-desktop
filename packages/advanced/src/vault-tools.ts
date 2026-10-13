/**
 * kvd-vault-tools — vault_propose_change (only write path → §11.3 proposal + Apply).
 */
import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import z from '@deepseek-ai/schemastery';

export const name = 'kvd-vault-tools';
export const inject = ['tools'];

export const Config = z.object({
  /** (change) => Promise<{ok, proposalId?, error?}> */
  onPropose: z.any(),
});

export interface ProposeChange {
  kind?: 'create' | 'edit' | 'move';
  path?: string;
  content?: string;
  from?: string;
  to?: string;
  summary?: string;
}

export type ProposeHandler = (
  change: ProposeChange,
) => Promise<{ ok: boolean; proposalId?: string; error?: string }> | { ok: boolean; proposalId?: string; error?: string };

export function apply(ctx: Context, config: { onPropose?: ProposeHandler } = {}): void {
  const onPropose: ProposeHandler =
    typeof config.onPropose === 'function'
      ? config.onPropose
      : async () => ({ ok: false, error: 'proposals unavailable' });

  ctx.tools.register(
    defineTool({
      name: 'vault_propose_change',
      description:
        'Propose ONE change to a note in the Obsidian vault (the working directory). You cannot write files any other way: '
        + 'the filesystem is read-only to you. The change is shown to the user, who must press Apply before anything is written. '
        + 'Paths are vault-relative. Never target .obsidian/ or 00-系统/. create never overwrites; move never replaces an existing file.',
      parameters: {
        kind: {
          type: 'string',
          required: true,
          enum: ['create', 'edit', 'move'],
          description: 'create a new note, edit (replace the full content of) an existing note, or move a note.',
        },
        path: { type: 'string', description: 'Vault-relative target path for create/edit.' },
        content: { type: 'string', description: 'Full Markdown content for create/edit.' },
        from: { type: 'string', description: 'Vault-relative source path for move.' },
        to: { type: 'string', description: 'Vault-relative destination path for move.' },
        summary: { type: 'string', description: 'One short sentence for the user explaining the change.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            proposalId: { type: 'string', required: true },
            status: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text:
              `Proposed change ${value.proposalId} is waiting for the user to Apply or Discard in Knowledge Vault. It has NOT been written yet.`,
          },
        ],
      },
      async execute(args) {
        const res = await onPropose(args || {});
        if (!res || !res.ok) throw new Error(`Proposal rejected: ${res?.error || 'unknown error'}`);
        return { proposalId: String(res.proposalId), status: 'pending-user-apply' };
      },
    }),
  );
}

export default { name, inject, Config, apply };
