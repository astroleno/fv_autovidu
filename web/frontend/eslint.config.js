import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    /**
     * eslint-plugin-react-hooks@7 的 recommended 会启用 React Compiler 相关规则；
     * 本仓库尚未按这些规则全面重构（effect 内 setState、refs 同步等大量为既有模式）。
     * 关闭后仍保留 hooks 规则与 exhaustive-deps，便于 `npm run lint` 在 CI/本地可稳定通过。
     */
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/refs': 'off',
    },
  },
])
