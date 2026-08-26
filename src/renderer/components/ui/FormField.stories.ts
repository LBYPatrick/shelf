import type { Meta, StoryObj } from '@storybook/vue3-vite';
import FormField from './FormField.vue';
import TextInput from './TextInput.vue';

/**
 * A label, a control, and the one line under it that explains or corrects.
 *
 * The field owns the `id` and hands it to the slot, so the label points at the
 * control rather than at a wrapper — which is the difference between a label a
 * screen reader reads out and one it ignores.
 */
const meta = {
  title: 'UI/FormField',
  component: FormField,
  args: { label: 'Host' },
  render: (args) => ({
    components: { FormField, TextInput },
    setup: () => ({ args }),
    template: `
      <div style="width:22rem;">
        <FormField v-bind="args">
          <template #default="{ id, describedBy }">
            <TextInput :id="id" :aria-describedby="describedBy" model-value="localhost" />
          </template>
        </FormField>
      </div>
    `,
  }),
} satisfies Meta<typeof FormField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Bare: Story = {};

export const WithHelp: Story = {
  args: { help: 'Leave blank to connect over the Unix socket.' },
};

/** An error replaces the help rather than joining it: two notes is one too many. */
export const WithError: Story = {
  args: { help: 'Leave blank for the default.', error: 'That is not a valid host name.' },
};
