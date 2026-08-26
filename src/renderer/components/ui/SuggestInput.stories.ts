import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import SuggestInput from './SuggestInput.vue';

/**
 * A field you type into, with a list of the answers most people want.
 *
 * The model name on the provider editor is genuinely both things: the handful
 * of names we ship cover almost everyone, and anyone pointing this at a local
 * server has a model name we have never heard of. A select locks them out; a
 * bare field makes the common case an act of remembering an exact string.
 *
 * It was a `<datalist>` — the platform's own answer to this, and unusable,
 * because its popup is drawn by the engine and cannot be styled at all. What it
 * opens now is the same `menulist` the select opens.
 */
const MODELS = ['qwen2.5-coder', 'llama3.1', 'mistral', 'deepseek-r1', 'phi4'];

const meta = {
  title: 'UI/SuggestInput',
  component: SuggestInput,
  args: { options: MODELS, ariaLabel: 'Model', monospace: true },
  render: (args) => ({
    components: { SuggestInput },
    setup: () => ({ args, value: ref('qwen2.5-coder') }),
    template: `
      <div style="width:22rem; padding:1.5rem;">
        <SuggestInput v-bind="args" v-model="value" />
      </div>
    `,
  }),
} satisfies Meta<typeof SuggestInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

/** A name we have never heard of, which is the normal case for a local server. */
export const OwnValue: Story = {
  render: (args) => ({
    components: { SuggestInput },
    setup: () => ({ args, value: ref('my-finetune:latest') }),
    template: `
      <div style="width:22rem; padding:1.5rem;">
        <SuggestInput v-bind="args" v-model="value" />
      </div>
    `,
  }),
};

/**
 * Long enough to need the list's own scroller, which is where the reserved room
 * for the chevron matters: a name that ran under it would be unreadable at
 * exactly the width where the field is most useful.
 */
export const ManyOptions: Story = {
  args: {
    options: [
      ...MODELS,
      'gemma2:27b',
      'codellama:34b',
      'qwen2.5:72b-instruct-q4_K_M',
      'nomic-embed-text',
      'starcoder2:15b',
    ],
  },
};

/** Words rather than identifiers, so the list is not set in mono. */
export const Plain: Story = {
  args: { options: ['Daily', 'Weekly', 'Monthly'], monospace: false },
  render: (args) => ({
    components: { SuggestInput },
    setup: () => ({ args, value: ref('Weekly') }),
    template: `
      <div style="width:22rem; padding:1.5rem;">
        <SuggestInput v-bind="args" v-model="value" />
      </div>
    `,
  }),
};
