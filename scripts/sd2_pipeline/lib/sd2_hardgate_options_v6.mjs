/**
 * SD2 v6/v7 block-chain quality gate policy.
 *
 * Default behavior is audit-first: produce complete artifacts and downgrade
 * gate failures to warnings. Use --strict-quality-hard to restore blocking.
 */

/**
 * @typedef {Record<string, string | boolean>} ArgsLike
 * @typedef {{
 *   allowV6Soft: boolean,
 *   strictQualityHard: boolean,
 *   skipKvaHard: boolean,
 *   skipSegHard: boolean,
 *   skipInfoHard: boolean,
 *   skipDialogueHard: boolean,
 *   skipPrompterSelfHard: boolean,
 *   skipDialoguePerShotHard: boolean,
 *   skipMinShotsHard: boolean,
 *   skipCharacterWhitelistHard: boolean,
 * }} V6HardgateOptions
 */

/**
 * Resolve v6/v7 quality gate switches from CLI args.
 *
 * @param {ArgsLike} args
 * @returns {V6HardgateOptions}
 */
export function resolveV6HardgateOptions(args) {
  const allowV6Soft = args['allow-v6-soft'] === true;
  const strictQualityHard = args['strict-quality-hard'] === true;
  const defaultSoft = !strictQualityHard;

  return {
    allowV6Soft,
    strictQualityHard,
    skipKvaHard: args['skip-kva-hard'] === true || allowV6Soft || defaultSoft,
    skipSegHard: args['skip-segment-coverage-hard'] === true || allowV6Soft || defaultSoft,
    skipInfoHard: args['skip-info-density-hard'] === true || allowV6Soft || defaultSoft,
    skipDialogueHard: args['skip-dialogue-fidelity-hard'] === true || allowV6Soft || defaultSoft,
    skipPrompterSelfHard:
      args['skip-prompter-selfcheck-hard'] === true || allowV6Soft || defaultSoft,
    skipDialoguePerShotHard:
      args['skip-dialogue-per-shot-hard'] === true || allowV6Soft || defaultSoft,
    skipMinShotsHard: args['skip-min-shots-hard'] === true || allowV6Soft || defaultSoft,
    skipCharacterWhitelistHard:
      args['skip-character-whitelist-hard'] === true || allowV6Soft || defaultSoft,
  };
}
