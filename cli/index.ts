// This is a CLI tool, using console is OK
/* eslint no-console: 0 */
import {spawn, exec} from 'node:child_process';
import type {ChildProcess, SpawnOptions} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';

import args from 'args';
import chalk from 'chalk';
import _columnify from 'columnify';
import got from 'got';
import open from 'open';
import ora from 'ora';
import {z} from 'zod';

import {version} from '../app/package.json';

import * as api from './api';

let commandPromise: Promise<void> | undefined;

/**
 * A failure the user is expected to cause and can act on, such as a missing
 * plugin name or an unlaunched Hyper.
 *
 * The distinction exists for the reporting path: an expected failure's message
 * is written for the user and stands alone, while an unexpected one is a
 * defect whose stack is the only useful part. Every message constructed here
 * is therefore already complete, with no placeholder waiting to be interpolated
 * by the reporter.
 */
class ExpectedFailureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpectedFailureError';
  }
}

/**
 * Records that a command has handled this invocation.
 *
 * `main` returns as soon as any handler has recorded one, so a command that
 * finishes synchronously must still call this. Otherwise control falls through
 * to the default action, which treats the command name as a path to launch and
 * fails with it reported as a missing directory.
 */
const completeCommand = (): void => {
  commandPromise = Promise.resolve();
};

const assertPluginName = (pluginName: string): string => {
  const normalizedPluginName = pluginName.trim();
  if (!normalizedPluginName) {
    throw new ExpectedFailureError(chalk.red('Plugin name is required'));
  }
  return normalizedPluginName;
};

const checkConfig = () => {
  if (api.exists()) {
    return true;
  }
  throw new ExpectedFailureError(
    chalk.red(`Error! Config file not found: ${api.configPath}\nPlease launch Hyper and retry.`)
  );
};

const columnify = (data: {name: string; description: string}[]) => {
  const maxNameLength = Math.max(...data.map((entry) => entry.name.length), 0);
  const descriptionWidth = process.stdout.columns - maxNameLength - 1;
  return _columnify(data, {
    showHeaders: false,
    config: {
      description: {
        maxWidth: descriptionWidth
      },
      name: {
        dataTransform: (nameValue) => chalk.green(nameValue)
      }
    }
  }).replaceAll(/\s+$/gm, ''); // remove padding from the end of all lines
};

const npmPackageSchema = z.object({
  name: z.string(),
  description: z.string().optional().default('')
});
const npmSearchEntrySchema = z.object({package: npmPackageSchema});
const npmSearchResponseSchema = z.object({results: z.array(npmSearchEntrySchema)});

const parseNpmSearchResults = (body: string) => {
  const response = npmSearchResponseSchema.parse(JSON.parse(body));
  return response.results.map(({package: npmPackage}) => ({
    name: npmPackage.name,
    description: npmPackage.description
  }));
};

args.command(
  'install',
  'Install a plugin',
  (_name, args_) => {
    checkConfig();
    const pluginName = assertPluginName(String(args_[0] ?? ''));
    const specifier = api.pluginSpecifier(pluginName);
    commandPromise = api
      .install(specifier)
      .then(() => console.log(chalk.green(`${pluginName} installed successfully!`)))
      .catch((error) => console.error(chalk.red(error)));
  },
  ['i']
);

args.command(
  'uninstall',
  'Uninstall a plugin',
  (_name, args_) => {
    checkConfig();
    const pluginName = assertPluginName(String(args_[0] ?? ''));
    const specifier = api.pluginSpecifier(pluginName);
    commandPromise = api
      .uninstall(specifier)
      .then(() => console.log(chalk.green(`${pluginName} uninstalled successfully!`)))
      .catch((error) => console.error(chalk.red(error)));
  },
  ['u', 'rm', 'remove']
);

args.command(
  'list',
  'List installed plugins',
  () => {
    checkConfig();
    const plugins = api.list();

    if (plugins) {
      console.log(plugins);
    } else {
      console.log(chalk.red(`No plugins installed yet.`));
    }
    completeCommand();
  },
  ['ls']
);

const lsRemote = (pattern?: string) => {
  // note that no errors are caught by this function
  const URL = `https://api.npms.io/v2/search?q=${
    (pattern && `${pattern}+`) || ''
  }keywords:hyper-plugin,hyper-theme&size=250`;
  return got(URL).then(({body}) => parseNpmSearchResults(body));
};

args.command(
  'search',
  'Search for plugins on npm',
  (_name, args_) => {
    const spinner = ora('Searching').start();
    const query = args_[0] ? args_[0].toLowerCase() : '';

    commandPromise = lsRemote(query)
      .then((entries) => {
        if (entries.length === 0) {
          spinner.fail();
          console.error(chalk.red(`Your search '${query}' did not match any plugins`));
          console.error(`${chalk.red('Try')} ${chalk.green('hyper ls-remote')}`);
          // Recorded here rather than thrown: the message above is the whole
          // report, and throwing would hand it to the `catch` below to print a
          // second time.
          process.exitCode = 1;
          return;
        } else {
          const msg = columnify(entries);
          spinner.succeed();
          console.log(msg);
        }
      })
      .catch((error) => {
        spinner.fail();
        console.error(chalk.red(error)); // TODO
        process.exitCode = 1;
      });
  },
  ['s']
);

args.command(
  'list-remote',
  'List plugins available on npm',
  () => {
    const spinner = ora('Searching').start();

    commandPromise = lsRemote()
      .then((entries) => {
        const msg = columnify(entries);
        spinner.succeed();
        console.log(msg);
      })
      .catch((error) => {
        spinner.fail();
        console.error(chalk.red(error)); // TODO
        process.exitCode = 1;
      });
  },
  ['lsr', 'ls-remote']
);

args.command(
  'docs',
  'Open the npm page of a plugin',
  (_name, args_) => {
    const pluginName = assertPluginName(String(args_[0] ?? ''));
    commandPromise = open(`http://ghub.io/${pluginName}`, {wait: false}).then(() => {});
  },
  ['d', 'h', 'home']
);

args.command(
  'version',
  'Show the version of hyper',
  () => {
    console.log(version);
    completeCommand();
  },
  []
);

args.command('<default>', 'Launch Hyper');

args.option(['v', 'verbose'], 'Verbose mode', false);

/** Builds the environment the launched app should inherit. */
const buildLaunchEnv = (isVerbose: boolean): NodeJS.ProcessEnv => {
  const env = Object.assign({}, process.env, {
    // this will signal Hyper that it was spawned from this module
    HYPER_CLI: '1',
    ELECTRON_NO_ATTACH_CONSOLE: '1'
  });

  delete env.ELECTRON_RUN_AS_NODE;

  if (isVerbose) {
    env.ELECTRON_ENABLE_LOGGING = '1';
  }
  return env;
};

/**
 * Resolves positional arguments to directories that exist.
 *
 * @throws {ExpectedFailureError} When a directory or file does not exist. The
 * message is thrown rather than logged because the top-level handler already
 * prints it; logging here as well would report the same failure twice.
 */
const resolveExistingPaths = (positional: string[]): string[] =>
  positional.map((arg) => {
    const cwd = path.isAbsolute(arg) ? arg : path.resolve(process.cwd(), arg);
    if (!existsSync(cwd)) {
      throw new ExpectedFailureError(chalk.red(`Error! Directory or file does not exist: ${cwd}`));
    }
    return cwd;
  });

/** Launches through `open` on macOS so a second Hyper process is not started. */
const launchViaOpen = (args_: string[], env: NodeJS.ProcessEnv) => {
  const cmd = `open -b co.zeit.hyper ${args_}`;
  return promisify(exec)(cmd, {env});
};

/** Streams a verbose child's output and resolves when it exits. */
const waitForVerboseChild = (child: ChildProcess): Promise<null> => {
  child.stdout?.on('data', (data: Buffer) => console.log(data.toString('utf8')));
  child.stderr?.on('data', (data: Buffer) => console.error(data.toString('utf8')));
  return new Promise((c) => child.once('exit', () => c(null)));
};

/** The parsed flags `args` supplies; only `verbose` affects launching. */
type LaunchFlags = {verbose: boolean};

const launchApp = (flags: LaunchFlags, env: NodeJS.ProcessEnv) => {
  const options: SpawnOptions = {
    detached: true,
    env
  };
  const args_ = resolveExistingPaths(args.sub);

  if (!flags.verbose) {
    options.stdio = 'ignore';
    if (process.platform === 'darwin') {
      return launchViaOpen(args_, env);
    }
  }

  const child = spawn(process.execPath, args_, options);
  if (flags.verbose) {
    return waitForVerboseChild(child);
  }
  child.unref();
  return Promise.resolve();
};

/**
 * Parses the launcher's flags.
 *
 * `args` types every option as `any`, so the result is narrowed to the one
 * option this module reads. The parser is configured to make `verbose`
 * boolean, so anything other than `true` means it was not passed.
 */
const parseLaunchFlags = (argv: string[]): LaunchFlags => {
  const parsed = args.parse(argv, {
    name: 'hyper',
    version: false,
    mri: {
      boolean: ['v', 'verbose']
    },
    mainColor: 'yellow',
    subColor: 'dim'
  });
  return {verbose: parsed.verbose === true};
};

const main = (argv: string[]) => {
  const flags: LaunchFlags = parseLaunchFlags(argv);

  if (commandPromise) {
    return commandPromise;
  }

  return launchApp(flags, buildLaunchEnv(flags.verbose));
};

/**
 * Reports an invocation failure and records a failing exit code.
 *
 * An `ExpectedFailureError` carries a message written for the user, so only
 * that message is printed; its stack would frame the report in the CLI's own
 * internals. Anything else is an unexpected defect, where the stack is the
 * part worth reading. Non-`Error` rejections have neither and are printed as
 * they are.
 *
 * @param error - The value a command rejected or threw with.
 */
const reportFailure = (error: unknown): void => {
  if (error instanceof ExpectedFailureError) {
    console.error(error.message);
  } else if (error instanceof Error) {
    console.error(error.stack || error);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
};

// esbuild emits this entrypoint as CommonJS, which cannot express top-level
// `await`, while the lint profile requires top-level promise chains to be
// awaited. A synchronous wrapper satisfies both. The `??=` preserves an exit
// code a command handler already recorded, such as a failed `search`.
const run = (): void => {
  try {
    main(process.argv).then(() => {
      process.exitCode ??= 0;
    }, reportFailure);
  } catch (error) {
    // `main` checks its positional paths before it yields, so a missing
    // directory throws here instead of rejecting the returned promise.
    reportFailure(error);
  }
};

run();
