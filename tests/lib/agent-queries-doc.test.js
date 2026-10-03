/**
 * docs/agent-queries.md must never name a route, method or query parameter
 * the API does not have (M17.11). Every `METHOD /api/...` in the doc is
 * checked against the OpenAPI spec generated from the route annotations.
 * Renames and removals are caught; changed semantics are not.
 */

const fs = require('fs');
const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');

const DOC_PATH = path.join(__dirname, '../../docs/agent-queries.md');
const ROUTES_GLOB = path.join(__dirname, '../../src/routes/*.js');
const REQUEST_PATTERN = /\b(GET|POST|PUT|DELETE)\s+(\/api\/[^\s`)|]+)/g;
const PLACEHOLDER_PATTERN = /^(\{[^}]+\}|<[^>]+>)$/;

const spec = swaggerJsdoc({ definition: { openapi: '3.0.0', info: { title: 'doc check', version: '0' } }, apis: [ROUTES_GLOB] });

/** Every `METHOD /api/path?query` in the doc, with the line it came from. */
function documentedRequests() {
  const requests = [];
  const lines = fs.readFileSync(DOC_PATH, 'utf8').split('\n');
  for (const [lineIndex, line] of lines.entries()) {
    for (const match of line.matchAll(REQUEST_PATTERN)) {
      const [pathPart, queryPart = ''] = match[2].split('?');
      const parameterNames = queryPart
        .split('&')
        .filter(Boolean)
        .map((pair) => pair.split('=')[0]);
      requests.push({ method: match[1].toLowerCase(), path: pathPart.replace(/\/$/, ''), parameterNames, line: lineIndex + 1 });
    }
  }
  return requests;
}

/** The spec path a documented path refers to: of the paths it fits, the one with the most literal segments in common. */
function findSpecPath(documentedPath) {
  const documentedSegments = documentedPath.split('/');
  let bestPath;
  let bestScore = -1;
  for (const specPath of Object.keys(spec.paths)) {
    const specSegments = specPath.split('/');
    const fits =
      specSegments.length === documentedSegments.length &&
      specSegments.every(
        (specSegment, index) => specSegment === documentedSegments[index] || PLACEHOLDER_PATTERN.test(documentedSegments[index]) || PLACEHOLDER_PATTERN.test(specSegment)
      );
    const literalMatches = specSegments.filter((specSegment, index) => specSegment === documentedSegments[index]).length;
    if (fits && literalMatches > bestScore) {
      bestPath = specPath;
      bestScore = literalMatches;
    }
  }
  return bestPath;
}

describe('docs/agent-queries.md', () => {
  const requests = documentedRequests();

  test('documents at least one request', () => {
    expect(requests.length).toBeGreaterThan(0);
  });

  test.each(requests.map((request) => [`${request.method.toUpperCase()} ${request.path} (line ${request.line})`, request]))('%s exists in the OpenAPI spec', (label, request) => {
    const specPath = findSpecPath(request.path);
    expect(specPath).toBeDefined();

    const operation = spec.paths[specPath][request.method];
    expect(operation).toBeDefined();

    const queryParameterNames = (operation.parameters || []).filter((parameter) => parameter.in === 'query').map((parameter) => parameter.name);
    for (const parameterName of request.parameterNames) {
      expect({ parameter: parameterName, known: queryParameterNames.includes(parameterName) }).toEqual({ parameter: parameterName, known: true });
    }
  });
});
