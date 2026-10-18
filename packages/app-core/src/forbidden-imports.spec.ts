import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const FORBIDDEN_MODULES = [
  /^react(\/|$)/,
  /^react-dom(\/|$)/,
  /^next(\/|$)/,
  /^zmp-sdk(\/|$)/,
  /^zmp-ui(\/|$)/,
  /^axios(\/|$)/,
  /^@tanstack\//,
];

const BROWSER_GLOBALS = new Set(['window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'self']);

function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

/** Trả danh sách vi phạm của một đoạn mã nguồn TS: import cấm và dùng global trình duyệt ở mức module. */
function findViolations(source: string, fileName = 'x.ts'): string[] {
  const kind = /\.[cm]?tsx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, kind);
  const found: string[] = [];

  const checkSpecifier = (spec: string) => {
    if (FORBIDDEN_MODULES.some((re) => re.test(spec))) found.push(`import "${spec}"`);
  };

  const visit = (node: ts.Node, insideFunction: boolean) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      checkSpecifier(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node)) {
      const [arg] = node.arguments;
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isDynamicImport || isRequire) && arg && ts.isStringLiteralLike(arg)) checkSpecifier(arg.text);
    }
    if (!insideFunction) {
      if (ts.isIdentifier(node) && BROWSER_GLOBALS.has(node.text) && isValueReference(node)) {
        found.push(`${node.text} ở mức module`);
      }
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'globalThis' &&
        BROWSER_GLOBALS.has(node.name.text)
      ) {
        found.push(`globalThis.${node.name.text} ở mức module`);
      }
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'process' &&
        node.name.text === 'env'
      ) {
        found.push('process.env ở mức module');
      }
    }
    const nextInside = insideFunction || isFunctionLike(node);
    ts.forEachChild(node, (child) => visit(child, nextInside));
  };

  visit(file, false);
  return found;
}

// Tên khai báo và khoá thuộc tính trùng tên global không phải là dùng global.
function isValueReference(id: ts.Identifier): boolean {
  const parent = id.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === id) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === id) return false;
  if (ts.isParameter(parent) && parent.name === id) return false;
  if (ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent)) return false;
  return true;
}

function isScannedSource(name: string): boolean {
  return /\.[cm]?tsx?$/.test(name) && !/\.spec\.[cm]?tsx?$/.test(name);
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listSourceFiles(full);
    return isScannedSource(name) ? [full] : [];
  });
}

describe('app-core không phụ thuộc nền tảng', () => {
  const srcDir = fileURLToPath(new URL('.', import.meta.url));

  it('quét được ít nhất một file nguồn', () => {
    expect(listSourceFiles(srcDir).length).toBeGreaterThan(0);
  });

  it('không file nguồn nào import gói nền tảng hay dùng global trình duyệt ở mức module', () => {
    const report = listSourceFiles(srcDir)
      .map((file) => ({ file, violations: findViolations(readFileSync(file, 'utf8')) }))
      .filter((r) => r.violations.length > 0);
    expect(report).toEqual([]);
  });
});

describe('findViolations tự kiểm', () => {
  it.each([
    ["import React from 'react';", 'import "react"'],
    ["import { x } from 'react-dom/client';", 'import "react-dom/client"'],
    ["import Link from 'next/link';", 'import "next/link"'],
    ["import { getSystemInfo } from 'zmp-sdk';", 'import "zmp-sdk"'],
    ["import { Page } from 'zmp-ui';", 'import "zmp-ui"'],
    ["import axios from 'axios';", 'import "axios"'],
    ["import { useQuery } from '@tanstack/react-query';", 'import "@tanstack/react-query"'],
    ["export * from 'react';", 'import "react"'],
    ["import { jsx } from 'react/jsx-runtime';", 'import "react/jsx-runtime"'],
    ["const s = sessionStorage.getItem('k');", 'sessionStorage ở mức module'],
    ['const n = navigator.userAgent;', 'navigator ở mức module'],
    ['const s = self.location;', 'self ở mức module'],
    ["const v = globalThis.localStorage;", 'globalThis.localStorage ở mức module'],
    ['const v = globalThis.window;', 'globalThis.window ở mức module'],
    ["const m = await import('axios');", 'import "axios"'],
    ["const a = require('zmp-sdk');", 'import "zmp-sdk"'],
    ['const w = window.innerWidth;', 'window ở mức module'],
    ['const d = document.title;', 'document ở mức module'],
    ["const v = localStorage.getItem('k');", 'localStorage ở mức module'],
    ['const e = process.env.NODE_ENV;', 'process.env ở mức module'],
    ['const f = () => 1; const w = typeof window;', 'window ở mức module'],
  ])('bắt vi phạm %s', (source, expected) => {
    expect(findViolations(source)).toContain(expected);
  });

  it.each([
    ["import type { X } from './http';"],
    ["import { z } from 'reactive-thing';"],
    ["import { a } from 'nextgen';"],
    ['export function f() { return window.innerWidth; }'],
    ['export const g = () => document.title;'],
    ["export const h = function () { return localStorage.getItem('k'); };"],
    ['export function p() { return process.env.NODE_ENV; }'],
    ['class A { m() { return window.x; } }'],
    ['const o = { window: 1 }; const n = o.window;'],
    ['type T = typeof process;'],
    ['export function f() { return globalThis.localStorage; }'],
    ['export const g = () => navigator.userAgent;'],
    ['const o = { self: 1 }; const n = o.self;'],
  ])('cho qua %s', (source) => {
    expect(findViolations(source)).toEqual([]);
  });
});

describe('quét file nguồn', () => {
  it.each(['a.ts', 'a.tsx', 'a.mts', 'a.cts', 'a.d.ts'])('quét %s', (name) => {
    expect(isScannedSource(name)).toBe(true);
  });

  it.each(['a.spec.ts', 'a.spec.tsx', 'a.spec.mts', 'a.json', 'a.mjs'])('bỏ qua %s', (name) => {
    expect(isScannedSource(name)).toBe(false);
  });

  it('bắt import react và global trình duyệt trong file .tsx', () => {
    const source = "import { useState } from 'react';\nconst el = <div />;\nconst w = window.innerWidth;";
    expect(findViolations(source, 'x.tsx')).toEqual(['import "react"', 'window ở mức module']);
  });
});
