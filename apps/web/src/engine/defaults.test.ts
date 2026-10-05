import { describe, expect, it } from 'vitest';
import { canonicalBackend } from './defaults';
import { createEngine, GRAPH_FALLBACK } from './adapter';

describe('engine defaults', () => {
  it('web.unit.backend-aliases: retired backend ids map to wasm-worker; unknown ids pass through', () => {
    expect(canonicalBackend('wasm-g4-worker')).toBe('wasm-worker');
    expect(canonicalBackend('ts-worker')).toBe('wasm-worker');
    expect(canonicalBackend('wasm-j-worker')).toBe('wasm-worker');
    expect(canonicalBackend('http')).toBe('http');
  });
  it('web.unit.graph-fallback: no current backend borrows another engine for graphs', () => {
    expect(GRAPH_FALLBACK).toEqual({});
    expect(createEngine({ backend: 'http', httpUrl: 'http://x', datasetUrl: '', wasmUrl: '' }).info.id).toBe('http');
  });
});
