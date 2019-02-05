import { params, skip, slow, suite, timeout } from "../../index";
import { AbstractPackageITBase, PackageTestParams } from "./AbstractPackageITBase";

import { ChildProcess, spawn } from "child_process";

import * as assert from "assert";
import { existsSync, unlinkSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import * as readline from "readline";

import * as terminate from "terminate";

const editFilePath = join(__dirname, "fixtures", "packages", "watcher", "test", "new.ts");
const cwd = resolve(__dirname, "fixtures", "packages", "watcher");

function assertStringContains(text: string, contains: string) {
  assert(text.includes(contains), "Expected '" + text + "' to includes '" + contains + "'.");
}

const isWin = process.platform == "win32"; // tslint:disable-line triple-equals

@suite(timeout(90000), slow(90000))
@skip(isWin)
class WatcherPackage extends AbstractPackageITBase {

  watch: ChildProcess;
  readline: readline.Interface;
  lines: string[];

  @params({ fixture: "watcher", installTypesMocha: false }, "can run watcher")
  @params({ fixture: "watcher", installTypesMocha: true }, "can run watcher with @types/mocha")
  async runTest(params: PackageTestParams) {
    super.runTest(params);
    this.watch = spawn("npm", ["run", "watch"], {
      cwd,
      shell: false,
    });
    this.readline = readline.createInterface({ input: this.watch.stdout, output: this.watch.stdin });
    this.lines = [];
    this.readline.on("line", (line) => {
      this.lines.push(line);
    });

    await this.line();
    await this.line(); // > module-usage@1.0.0 watch ...
    await this.line(); // > mocha-typescript-watch ...
    await this.line();

    assertStringContains(await this.line(), "Found 0 errors. Watching for file changes.");
    assertStringContains(await this.line(), "Run mocha.");
    await this.line();
    await this.line();
    assertStringContains(await this.line(), "Test1");
    await this.line();
    await this.line();
    await this.line();
    assertStringContains(await this.line(), "1 passing");

    writeFileSync(editFilePath, `
      import { suite, test } from "mocha-typescript";
      @suite
      class Test2 {
          @test
          method2() {
            throw "not implemented";
          }
      }
    `);

    await this.line();
    assertStringContains(await this.line(), "File change detected. Starting incremental compilation...");
    assertStringContains(await this.line(), "Found 0 errors. Watching for file changes.");
    assertStringContains(await this.line(), "Run mocha.");
    await this.line();
    await this.line();
    assertStringContains(await this.line(), "Test2");
    assertStringContains(await this.line(), "method2");
    await this.line();

    assertStringContains(await this.line(), "Test1");
    assertStringContains(await this.line(), "method");
    await this.line();
    await this.line();
    assertStringContains(await this.line(), "1 passing");
    assertStringContains(await this.line(), "1 failing");

    if (this.watch) {
      await this.sendCtrlCAndExit();
    }
  }

  line(): Promise<string> {
    if (this.lines.length > 0) {
      const line = this.lines.shift();
      return Promise.resolve(line);
    }

    return new Promise((resolve, reject) => {
      let unsubscribe;
      const onLine = (l: string) => {
        const line = this.lines.shift();
        unsubscribe();
        resolve(line);
      };
      const onClose = () => {
        unsubscribe();
        reject(new Error("Line reader closed."));
      };
      unsubscribe = () => {
        this.readline.removeListener("line", onLine);
        this.readline.removeListener("close", onClose);
      };
      this.readline.addListener("line", onLine);
      this.readline.addListener("close", onClose);
    });
  }

  sendCtrlCAndExit(): Promise<void> {
    const promise = new Promise<void>((resolve, reject) => {
      terminate(this.watch.pid, (err) => {
        this.watch = null;
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
    return promise;
  }

  before() {
    if (existsSync(editFilePath)) {
      unlinkSync(editFilePath);
    }
  }

  async after() {
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }

    if (this.watch) {
      await this.sendCtrlCAndExit();
    }

    if (existsSync(editFilePath)) {
      unlinkSync(editFilePath);
    }
  }
}