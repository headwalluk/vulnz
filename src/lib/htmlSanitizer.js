const sanitizeHtml = require('sanitize-html');

/**
 * Sanitize HTML for use in email templates
 * Allows email-safe HTML tags and attributes while preventing XSS
 *
 * @param {string} html - The HTML string to sanitize
 * @returns {string} - Sanitized HTML safe for email templates
 */
function sanitizeEmailHtml(html) {
  if (!html || typeof html !== 'string') {
    return '';
  }

  // Trim to max 16384 characters (16 KB)
  const trimmedHtml = html.substring(0, 16384);

  const options = {
    allowedTags: [
      // Table elements (essential for email layout)
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'td',
      'th',
      // Text elements
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'span',
      'div',
      // Formatting
      'strong',
      'em',
      'b',
      'i',
      'u',
      'br',
      // Links and images
      'a',
      'img',
      // SVG for inline logos
      'svg',
      'path',
      'circle',
      'rect',
      'line',
      'polyline',
      'polygon',
      'text',
      'g',
      'defs',
      'linearGradient',
      'stop',
    ],
    allowedAttributes: {
      '*': ['style', 'align', 'valign', 'width', 'height', 'class'],
      table: ['role', 'cellspacing', 'cellpadding', 'border', 'bgcolor'],
      td: ['colspan', 'rowspan', 'bgcolor'],
      th: ['colspan', 'rowspan', 'scope', 'bgcolor'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      a: ['href', 'title', 'target'],
      svg: ['width', 'height', 'viewBox', 'xmlns', 'fill', 'stroke'],
      path: ['d', 'fill', 'stroke', 'stroke-width'],
      circle: ['cx', 'cy', 'r', 'fill', 'stroke'],
      rect: ['x', 'y', 'width', 'height', 'fill', 'stroke', 'rx', 'ry'],
      line: ['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width'],
      polyline: ['points', 'fill', 'stroke'],
      polygon: ['points', 'fill', 'stroke'],
      text: ['x', 'y', 'font-family', 'font-size', 'font-weight', 'fill', 'text-anchor'],
      g: ['transform', 'fill', 'stroke'],
      linearGradient: ['id', 'x1', 'y1', 'x2', 'y2'],
      stop: ['offset', 'stop-color', 'stop-opacity'],
    },
    allowedStyles: {
      '*': {
        // Color properties
        color: [/^#[0-9a-f]{3,6}$/i, /^rgb\(/, /^rgba\(/],
        background: [/.*/],
        'background-color': [/^#[0-9a-f]{3,6}$/i, /^rgb\(/, /^rgba\(/, /^linear-gradient\(/, /^transparent$/i],
        'background-image': [/^linear-gradient\(/, /^url\(/],
        // Typography
        'font-size': [/^\d+(?:px|em|%|pt)$/],
        'font-weight': [/^\d+$/, /^bold$/, /^normal$/, /^lighter$/, /^bolder$/],
        'font-family': [/.*/],
        'line-height': [/^\d+(?:px|em|%)?$/],
        'letter-spacing': [/^-?\d+(?:px|em)$/],
        'text-align': [/^left$/, /^right$/, /^center$/, /^justify$/],
        'text-decoration': [/^none$/, /^underline$/, /^line-through$/],
        'text-transform': [/^uppercase$/, /^lowercase$/, /^capitalize$/, /^none$/],
        // Spacing
        padding: [/^\d+(?:px|em|%)(?:\s+\d+(?:px|em|%)){0,3}$/],
        'padding-top': [/^\d+(?:px|em|%)$/],
        'padding-right': [/^\d+(?:px|em|%)$/],
        'padding-bottom': [/^\d+(?:px|em|%)$/],
        'padding-left': [/^\d+(?:px|em|%)$/],
        margin: [/^\d+(?:px|em|%)(?:\s+\d+(?:px|em|%)){0,3}$/, /^0$/, /^auto$/],
        'margin-top': [/^\d+(?:px|em|%)$/, /^0$/, /^auto$/],
        'margin-right': [/^\d+(?:px|em|%)$/, /^0$/, /^auto$/],
        'margin-bottom': [/^\d+(?:px|em|%)$/, /^0$/, /^auto$/],
        'margin-left': [/^\d+(?:px|em|%)$/, /^0$/, /^auto$/],
        // Layout
        width: [/^\d+(?:px|em|%)?$/, /^auto$/, /^max-content$/],
        height: [/^\d+(?:px|em|%)?$/, /^auto$/],
        'max-width': [/^\d+(?:px|em|%)?$/],
        'max-height': [/^\d+(?:px|em|%)?$/],
        'min-width': [/^\d+(?:px|em|%)?$/],
        'min-height': [/^\d+(?:px|em|%)?$/],
        display: [/^block$/, /^inline$/, /^inline-block$/, /^none$/, /^table$/, /^table-cell$/, /^table-row$/],
        'vertical-align': [/^top$/, /^middle$/, /^bottom$/, /^baseline$/],
        // Border
        border: [/.*/],
        'border-top': [/.*/],
        'border-right': [/.*/],
        'border-bottom': [/.*/],
        'border-left': [/.*/],
        'border-width': [/^\d+(?:px|em)(?:\s+\d+(?:px|em)){0,3}$/],
        'border-style': [/^solid$/, /^dashed$/, /^dotted$/, /^none$/],
        'border-color': [/^#[0-9a-f]{3,6}$/i, /^rgb\(/, /^rgba\(/],
        'border-radius': [/^\d+(?:px|em|%)(?:\s+\d+(?:px|em|%)){0,3}$/],
        // Other
        opacity: [/^0?\.\d+$/, /^1$/],
      },
    },
    // Disallow script execution
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      img: ['http', 'https', 'data'],
    },
    // Remove all script-like content
    disallowedTagsMode: 'discard',
  };

  return sanitizeHtml(trimmedHtml, options);
}

module.exports = {
  sanitizeEmailHtml,
};
