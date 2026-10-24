/** @file Prompts for the one-line summary included in release notes. */
import {prompt} from 'inquirer';

const release = async (markdown) => {
  const answers = await prompt([{name: 'intro', message: 'One-Line Release Summary'}]);
  const {intro} = answers;
  if (intro === '') throw new Error('Please specify a release summary!');
  return `${intro}\n\n${markdown}`;
};

export default release;
