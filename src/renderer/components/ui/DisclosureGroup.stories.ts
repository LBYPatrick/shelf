import type { Meta, StoryObj } from '@storybook/vue3-vite';
import DisclosureGroup from './DisclosureGroup.vue';

/** A section that folds away, for the settings nobody changes twice. */
const meta = {
  title: 'UI/DisclosureGroup',
  component: DisclosureGroup,
  args: { label: 'SSH tunnel', modelValue: false },
  render: (args) => ({
    components: { DisclosureGroup },
    setup: () => ({ args }),
    template: `
      <div style="width:24rem;">
        <DisclosureGroup v-bind="args">
          <p style="font-size:0.8125rem; line-height:1.6; margin:0;">
            Reaching the database through a machine you can log into. Separate
            from a proxy because they are different arrangements, not two
            settings of one.
          </p>
        </DisclosureGroup>
      </div>
    `,
  }),
} satisfies Meta<typeof DisclosureGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};
export const Open: Story = { args: { modelValue: true } };
export const WithHint: Story = { args: { modelValue: true, hint: 'Not in use' } };
