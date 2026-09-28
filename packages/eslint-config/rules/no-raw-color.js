const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FUNC_COLOR_RE = /^(rgb|rgba|hsl|hsla)\(/i;
const COLOR_PROPS = new Set([
  'color',
  'background',
  'backgroundColor',
  'borderColor',
  'fill',
  'stroke',
  'boxShadow',
]);

/** Cấm hex/rgb() thô trong style={{}} — dùng var(--token) (Design System v2, spec §6). */
export default {
  meta: {
    type: 'problem',
    messages: { rawColor: 'Màu thô "{{value}}" — dùng var(--token) thay vì hex/rgb trực tiếp.' },
  },
  create(context) {
    return {
      Property(node) {
        if (node.key.type !== 'Identifier' || !COLOR_PROPS.has(node.key.name)) return;
        if (node.value.type !== 'Literal' || typeof node.value.value !== 'string') return;
        const v = node.value.value;
        if (HEX_RE.test(v) || FUNC_COLOR_RE.test(v)) {
          context.report({ node: node.value, messageId: 'rawColor', data: { value: v } });
        }
      },
    };
  },
};
