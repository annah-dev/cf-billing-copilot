import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const engineRoot = resolve("src/engine");
const contractsRoot = resolve("src/contracts");

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory()
      ? files(path)
      : /\.[cm]?tsx?$/.test(entry.name)
        ? [path]
        : [];
  });
}

it("engine imports only its own modules, contracts and zod (including dynamic and type imports)", () => {
  const failures: string[] = [];
  for (const file of files(engineRoot)) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true
    );
    const check = (specifier: ts.Node) => {
      if (!ts.isStringLiteralLike(specifier)) {
        failures.push(`${file}: nonliteral import`);
        return;
      }
      const name = specifier.text;
      const target = resolve(file, "..", name);
      const within = (root: string) => {
        const path = relative(root, target);
        return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
      };
      if (
        name !== "zod" &&
        (!name.startsWith(".") ||
          (!within(engineRoot) && !within(contractsRoot)))
      )
        failures.push(`${file}: ${name}`);
    };
    const visit = (node: ts.Node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier
      )
        check(node.moduleSpecifier);
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
        check(node.argument.literal);
      if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression
      )
        check(node.moduleReference.expression);
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require"))
      ) {
        if (node.arguments.length !== 1)
          failures.push(`${file}: invalid import arguments`);
        else check(node.arguments[0]);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(failures).toEqual([]);
});
