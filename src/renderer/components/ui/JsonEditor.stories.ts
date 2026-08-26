import type { Meta, StoryObj } from '@storybook/vue3-vite';
import JsonEditor from './JsonEditor.vue';

/**
 * Settings as a document.
 *
 * The form is the good way to change one setting and a file is the good way to
 * move a hundred, so neither is the "real" one — this is the other view of the
 * same state.
 */
const document = JSON.stringify(
  {
    kind: 'shelf.settings',
    version: 1,
    appearance: { mode: 'system', density: 'default', opacity: 0.6 },
    preferences: { pageSize: 100, maxRows: 500, language: 'system' },
  },
  null,
  2
);

const meta = {
  title: 'UI/JsonEditor',
  component: JsonEditor,
  args: { modelValue: document, label: 'Settings', readOnly: false },
  parameters: { layout: 'fullscreen' },
  render: (args) => ({
    components: { JsonEditor },
    setup: () => ({ args }),
    template: `<div style="width:44rem; height:20rem;"><JsonEditor v-bind="args" /></div>`,
  }),
} satisfies Meta<typeof JsonEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Editable: Story = {};
export const ReadOnly: Story = { args: { readOnly: true } };
export const Empty: Story = { args: { modelValue: '' } };
