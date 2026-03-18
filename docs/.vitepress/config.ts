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
      { text: 'Examples', link: '/examples/' },
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
            { text: 'MCP Tools', link: '/guide/mcp' },
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
      '/examples/': [
        {
          text: 'Examples',
          items: [
            { text: 'Overview', link: '/examples/' },
            { text: 'Blog Post Pipeline', link: '/examples/blog-post-pipeline' },
            { text: 'Support Router', link: '/examples/support-router' },
            { text: 'Competitive Analysis', link: '/examples/competitive-analysis' },
            { text: 'Code Review Agent', link: '/examples/code-review-agent' },
            { text: 'Cover Letter Generator', link: '/examples/cover-letter-generator' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'agent()', link: '/api/agent' },
            { text: 'Agent Registry', link: '/api/registry' },
            { text: 'configure()', link: '/api/configure' },
            { text: 'runAgent()', link: '/api/run-agent' },
            { text: 'Pipeline', link: '/api/pipeline' },
            { text: 'defineTool()', link: '/api/define-tool' },
            { text: 'buildSchema()', link: '/api/build-schema' },
            { text: 'Prompt Templates', link: '/api/prompt-templates' },
            { text: 'Context Window', link: '/api/context-manager' },
          ],
        },
        {
          text: 'Providers',
          items: [
            { text: 'openai()', link: '/api/openai' },
            { text: 'anthropic()', link: '/api/anthropic' },
            { text: 'google()', link: '/api/google' },
            { text: 'xai()', link: '/api/xai' },
            { text: 'openrouter()', link: '/api/openrouter' },
            { text: 'vercelAI()', link: '/api/vercel' },
            { text: 'Stripe', link: '/api/stripe' },
            { text: 'createProvider()', link: '/api/create-provider' },
            { text: 'Custom Provider', link: '/api/custom-provider' },
          ],
        },
        {
          text: 'Built-in Tools',
          items: [
            { text: 'WebFetch', link: '/api/web-fetch' },
          ],
        },
        {
          text: 'MCP',
          items: [
            { text: 'connectMcp()', link: '/api/connect-mcp' },
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
