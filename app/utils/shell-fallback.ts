/** Suggests a fallback shell configuration to retry after an early shell exit, or `null` if none applies. */
export const getFallBackShellConfig = (
  shell: string,
  shellArgs: string[],
  defaultShell: string,
  defaultShellArgs: string[]
): {
  /** The shell executable to retry with. */
  shell: string;
  /** Arguments to pass to the fallback shell. */
  shellArgs: string[];
} | null => {
  if (shellArgs.length > 0) {
    return {
      shell,
      shellArgs: []
    };
  }

  if (shell !== defaultShell) {
    return {
      shell: defaultShell,
      shellArgs: defaultShellArgs
    };
  }

  return null;
};
