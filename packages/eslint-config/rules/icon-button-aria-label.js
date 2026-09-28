/** IconButton (hoặc bất kỳ phần tử chỉ có icon con, không có text) phải có aria-label/label. */
export default {
  meta: {
    type: 'problem',
    messages: { missingLabel: '{{name}} chỉ có icon — cần prop `label`/`aria-label`.' },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const name = node.name.type === 'JSXIdentifier' ? node.name.name : null;
        if (name !== 'IconButton') return;
        const hasLabel = node.attributes.some(
          (a) =>
            a.type === 'JSXAttribute' && (a.name.name === 'label' || a.name.name === 'aria-label'),
        );
        if (!hasLabel) context.report({ node, messageId: 'missingLabel', data: { name } });
      },
    };
  },
};
