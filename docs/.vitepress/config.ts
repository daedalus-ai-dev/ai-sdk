import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Daedalus AI SDK',
  description: 'A TypeScript SDK for building agents, tools, and multi-agent workflows',
  base: '/ai-sdk/',

  head: [
    ['link', { rel: 'icon', href: '/ai-sdk/favicon.svg', type: 'image/svg+xml' }],
  ],

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Patterns', link: '/patterns/overview' },
      { text: 'API', link: '/api/agent' },
      {
        text: 'v0.1.0',
        items: [
          { text: 'Changelog', link: 'https://github.com/daedalus-ai-dev/ai-sdk/releases' },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'Quick Start', link: '/guide/quick-start' },
          ],
        },
        {
          text: 'Core Concepts',
          items: [
            { text: 'Agents', link: '/guide/agents' },
            { text: 'Tools', link: '/guide/tools' },
            { text: 'Schema Builder', link: '/guide/schema' },
            { text: 'Providers', link: '/guide/providers' },
            { text: 'Streaming', link: '/guide/streaming' },
          ],
        },
      ],
      '/patterns/': [
        {
          text: 'Multi-Agent Patterns',
          items: [
            { text: 'Overview', link: '/patterns/overview' },
            { text: 'Prompt Chaining', link: '/patterns/prompt-chaining' },
            { text: 'Routing', link: '/patterns/routing' },
            { text: 'Parallelization', link: '/patterns/parallelization' },
            { text: 'Orchestrator-Workers', link: '/patterns/orchestrator-workers' },
            { text: 'Evaluator-Optimizer', link: '/patterns/evaluator-optimizer' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'agent()', link: '/api/agent' },
            { text: 'configure()', link: '/api/configure' },
            { text: 'runAgent()', link: '/api/run-agent' },
            { text: 'Pipeline', link: '/api/pipeline' },
            { text: 'defineTool()', link: '/api/define-tool' },
            { text: 'buildSchema()', link: '/api/build-schema' },
          ],
        },
        {
          text: 'Providers',
          items: [
            { text: 'OpenRouter', link: '/api/openrouter' },
            { text: 'Custom Provider', link: '/api/custom-provider' },
          ],
        },
        {
          text: 'Built-in Tools',
          items: [
            { text: 'WebFetch', link: '/api/web-fetch' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/daedalus-ai-dev/ai-sdk' },
    ],

    search: {
      provider: 'local',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Daedalus AI',
    },

    editLink: {
      pattern: 'https://github.com/daedalus-ai-dev/ai-sdk/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },

  markdown: {
    theme: {
      light: 'github-light',
      dark: 'github-dark',
    },
  },
});
