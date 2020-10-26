'use babel';

export default {
  config: {
    ansibleLintExecutablePath: {
      title: 'Ansible-Lint Executable Path',
      type: 'string',
      description: 'Path to Ansible-Lint executable (e.g. /usr/bin/ansible-lint) if not in shell env path.',
      default: 'ansible-lint',
    },
    rulesDirDefault: {
      title: 'Additionally use the default rules directories with Ansible-Lint (only if using non-default rules directories).',
      type: 'boolean',
      default: false,
    },
    rulesDirs: {
      title: 'Rules Directories',
      type: 'array',
      description: 'Non-default rules directories to use with Ansible-Lint.',
      default: [''],
      items: {
        type: 'string'
      }
    },
    excludeDirs: {
      title: 'Exclude Directories',
      type: 'array',
      description: 'Absolute path directories to exclude during linting.',
      default: [''],
      items: {
        type: 'string'
      }
    },
    useProjectConfig: {
      title: 'Use project Ansible-Lint config file.',
      type: 'boolean',
      description: 'Use an ansible-lint configuration file named `.ansible-lint` in the root level of the project directory. Overrides other settings besides executable path and blacklist.',
      default: false,
    },
    blacklist: {
      title: 'Exclude Regexp for .yml',
      type: 'string',
      description: 'Regular expression for .yml filenames to ignore (e.g. travis|docker would ignore docker-compose.yml and .travis.yml).',
      default: '',
    },
    ruleSkips: {
      title: 'Tag/Rule Skips',
      type: 'string',
      description: 'List of comma-delimited tags and/or rules to skip when performing checks.',
      default: '',
    },
    timeout: {
      title: 'Linting Timeout',
      type: 'number',
      description: 'Number of seconds to wait on lint attempt before timing out.',
      default: 10,
    },
    displaySeverity: {
      title: 'Display Severity',
      type: 'boolean',
      description: 'Display the severity of the warning inside the message.',
      default: false,
    }
  },

  // activate linter
  activate() {
    const helpers = require('atom-linter');

    // check for ansible-lint >= minimum version
    helpers.exec(atom.config.get('linter-ansible-linting.ansibleLintExecutablePath'), ['-T']).then(output => {
      if (!(/repeatability/.exec(output))) {
        atom.notifications.addWarning(
          'ansible-lint < 3.5 is unsupported. Backwards compatibility should exist, but is not guaranteed.',
          {
            detail: "Please upgrade your version of ansible-lint to >= 3.5.\n",
            dismissable: true
          }
        );
      }
    });
  },

  provideLinter() {
    return {
      name: 'Ansible-Lint',
      grammarScopes: ['source.ansible', 'source.ansible-advanced'],
      scope: 'project',
      lintsOnChange: false,
      lint: (activeEditor) => {
        // setup variables
        const helpers = require('atom-linter');
        const lint_regex = /(.*):(\d+):\s\[E\d{3}\]\s(.*)/;
        const file = activeEditor.getPath();
        const dir = require('path').dirname(file);
        const correct_file = new RegExp(file);

        // bail out if this is on the blacklist
        if (atom.config.get('linter-ansible-linting.blacklist') !== '') {
          blacklist = new RegExp(atom.config.get('linter-ansible-linting.blacklist'))
          if (blacklist.exec(file))
            return [];
        }

        // pep8 output and no color
        var args = ['-p', '--nocolor'];

        // add parseable severity flag if requested
        if (atom.config.get('linter-ansible-linting.displaySeverity'))
          args.push('--parseable-severity');

        // use config file if specified
        if (atom.config.get('linter-ansible-linting.useProjectConfig')) {
          // cannot cwd in project path and then add file relative path to args because ansible relies on pathing relative to directory execution for includes
          const project_path = atom.project.relativizePath(file)[0];

          // use ansible-lint config file in root project level
          args.push(...['-c', project_path + '/.ansible-lint'])
        }
        else {
          // skip checks that user has opted to skip
          if (atom.config.get('linter-ansible-linting.ruleSkips') != '')
            args.push(...['-x', atom.config.get('linter-ansible-linting.ruleSkips')])

          // add additional rules directories
          if (atom.config.get('linter-ansible-linting.rulesDirs')[0] !== '') {
            if (atom.config.get('linter-ansible-linting.rulesDirDefault'))
              args.push('-R')

            for (i = 0; i < atom.config.get('linter-ansible-linting.rulesDirs').length; i++)
              args.push(...['-r', atom.config.get('linter-ansible-linting.rulesDirs')[i]]);
          }

          // exclude certain directories from checks
          if (atom.config.get('linter-ansible-linting.excludeDirs')[0] != '')
            for (i = 0; i < atom.config.get('linter-ansible-linting.excludeDirs').length; i++)
              args.push(...['--exclude', atom.config.get('linter-ansible-linting.excludeDirs')[i]]);
        }

        // add file to check
        args.push(file);

        // initialize variable for linter return here for either linter output or errors
        var toReturn = [];

        return helpers.exec(atom.config.get('linter-ansible-linting.ansibleLintExecutablePath'), args, {cwd: dir, stream: 'both', ignoreExitCode: true, throwOnStderr: false,  timeout: atom.config.get('linter-ansible-linting.timeout') * 1000}).then(output => {
          output.stdout.split(/\r?\n/).forEach((line) => {
            const lint_matches = lint_regex.exec(line);
            const correct_file_matches = correct_file.exec(line);

            // check for normal linter checks output
            if (lint_matches != null && correct_file_matches != null) {
              toReturn.push({
                severity: 'warning',
                excerpt: lint_matches[3],
                location: {
                  file: file,
                  position: [[Number.parseInt(lint_matches[2]) - 1, 0], [Number.parseInt(lint_matches[2]) - 1, 1]],
                },
              });
            }
            // check for linting issues in other files
            else if (lint_matches != null) {
              toReturn.push({
                severity: 'warning',
                excerpt: lint_matches[3],
                location: {
                  // ansible-lint plus atom-linter combined now lose pathing info for this kind of parsing
                  // prepend dir to file
                  file: require('path').sep + lint_matches[1],
                  position: [[Number.parseInt(lint_matches[2]) - 1, 0], [Number.parseInt(lint_matches[2]) - 1, 1]],
                },
              });
            }
          });
          // parse stderr
          stderr = output.stderr
          // check for unusual issues with playbook files
          const missing_file_matches = /WARNING: Couldn't open (.*) - No such file or directory/.exec(stderr);
          const unreadable_file_matches = /the file_name (.*) does not exist, or is not readable|Could not find or access '(.*)'|error occurred while trying to read the file '(.*)':/.exec(stderr);
          const yaml_syntax_matches = /Syntax Error while loading YAML/.exec(stderr);
          const syntax_matches = /(?:raise Ansible(Parser)?Error|Couldn't parse task at|AttributeError)/.exec(stderr);
          const vault_matches = /vault password.*decrypt/.exec(stderr);
          const stdin_matches = /\.dirname/.exec(stderr);
          const extra_output_matches = /skip specific rules/.exec(stderr);

          // check for missing file or directory
          if (missing_file_matches != null) {
            toReturn.push({
              severity: 'error',
              excerpt: 'Missing file ' + missing_file_matches[1] + '. Please fix before continuing linter use.',
              location: {
                file: file,
                position: [[0, 0], [0, 1]],
              },
            });
          }
          // check for unreadable file
          else if (unreadable_file_matches != null) {
            // the unreadable filename might be in either 1, 2, or 3 depending upon the message, which depends upon the version of ansible-lint; if we join the array of substrings, this efficiently assigns the captured file name
            var unreadable_file = [unreadable_file_matches[1], unreadable_file_matches[2], unreadable_file_matches[3]].join('')

            toReturn.push({
              severity: 'error',
              excerpt: unreadable_file + ' is unreadable or not a file. Please fix before continuing linter use.',
              location: {
                file: file,
                position: [[0, 0], [0, 1]],
              },
            });
          }
          // check for yaml syntax issue
          else if (yaml_syntax_matches != null) {
            // capture file and line info
            const file_matches = /The error appears to be in '(.*)':/.exec(stderr);
            const range_matches = /line\s(\d+),\scolumn\s(\d+)/.exec(stderr);

            toReturn.push({
              severity: 'error',
              excerpt: 'YAML syntax error.',
              location: {
                file: file_matches[1],
                position: [[Number.parseInt(range_matches[1]) - 1, Number.parseInt(range_matches[2]) - 1], [Number.parseInt(range_matches[1]) - 1, Number.parseInt(range_matches[2])]],
              },
            });
          }
          // check for syntax issue
          else if (syntax_matches != null) {
            // attempt to guess location of error message and parse it
            const error_matches = /\.ya?ml:\d+ (.*)/.exec(stderr);
            error = error_matches[1] == null ? 'Ansible syntax error.' : error_matches[1]
            // capture file info
            const file_matches = /The error appears to be in '(.*)':|parse task at (.*):\d+/.exec(stderr);
            //local_file = file_matches[1] == null ? file_matches[2] : file_matches[1]
            local_file = file
            // capture as much line and col info as possible
            const range_matches = /line\s(\d+),\scolumn\s(\d+)|\.ya?ml:(\d+)/.exec(stderr);
            //range = range_matches[1] == null ? [range_matches[3], 1] : [range_matches[1], range_matches[2]]
            range = [1, 1]

            toReturn.push({
              severity: 'error',
              excerpt: error,
              location: {
                file: local_file,
                // range now an array instead of regexp matches
                position: [[Number.parseInt(range[0]) - 1, Number.parseInt(range[1]) - 1], [Number.parseInt(range[0]) - 1, Number.parseInt(range[1])]],
              },
            });
          }
          // check for vault encrypted file
          else if (vault_matches != null) {
            toReturn.push({
              severity: 'info',
              excerpt: 'File must be decrypted with ansible-vault prior to linting.',
              location: {
                file: file,
                position: [[0, 0], [0, 1]],
              },
            });
          }
          // check for stdin lint attempt
          else if (stdin_matches != null) {
            toReturn.push({
              severity: 'info',
              excerpt: 'Ansible-Lint cannot reliably lint on stdin due to nonexistent pathing on includes and roles. Please save this playbook to your filesystem.',
              location: {
                file: 'Save this playbook.',
                position: [[0, 0], [0, 1]],
              },
            });
          }
          // output other errors directly to Atom notification display
          else if ((extra_output_matches == null) && (stderr != '')) {
            atom.notifications.addError(
              'An unexpected error with ansible, ansible-lint, linter-ansible-linting, atom, linter, and/or your playbook, has occurred.',
              {
                detail: stderr
              }
            );
          };
          return toReturn;
        });
      }
    };
  }
};
