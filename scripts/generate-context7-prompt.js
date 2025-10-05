#!/usr/bin/env node

/**
 * Context7 Prompt Generator
 * 
 * This script analyzes code files and generates Context7 documentation prompts
 * to help developers understand what documentation they need when working with files.
 * 
 * Features:
 * - AI-powered library detection using OpenAI, Anthropic, or Google APIs
 * - Fallback to pattern-based analysis when AI APIs are not available
 * - Comprehensive technology detection (React, TypeScript, Tailwind, etc.)
 * - Dynamic focus topic generation based on file content
 * - Duplicate prevention to avoid adding headers multiple times
 * - Helpful error messages with links to get API keys
 * 
 * Usage:
 *   npm run generate-prompt <file-path>
 *   node scripts/generate-context7-prompt.js <file-path>
 * 
 * Examples:
 *   npm run generate-prompt app/routes/library.tsx
 *   npm run generate-prompt app/utils/storage.server.ts
 *   npm run generate-prompt prisma/schema.prisma
 * 
 * Environment Variables (optional):
 *   OPENAI_API_KEY    - OpenAI API key for GPT-4 analysis (get from https://platform.openai.com/account/api-keys)
 *   ANTHROPIC_API_KEY - Anthropic API key for Claude analysis (get from https://console.anthropic.com/)
 *   GOOGLE_API_KEY    - Google API key for Gemini analysis (get from https://makersuite.google.com/app/apikey)
 * 
 * Note: If no API keys are provided, the script will fall back to pattern-based analysis
 * which is less comprehensive but still functional.
 * 
 * Output:
 *   Generates Context7 prompts with resolve-library-id commands for all detected libraries
 * 
 * Supported File Types:
 *   - JavaScript/TypeScript (.js, .jsx, .ts, .tsx)
 *   - Python (.py)
 *   - Ruby (.rb)
 *   - Go (.go)
 *   - Rust (.rs)
 *   - Java (.java)
 *   - C# (.cs)
 *   - C/C++ (.c, .cpp, .h)
 *   - HTML (.html, .htm)
 *   - CSS (.css, .scss, .sass)
 *   - Configuration files (.toml, .yml, .json, etc.)
 * 
 * Technology Detection:
 *   - Imported packages and dependencies
 *   - APIs being used (Fetch API, Web APIs, etc.)
 *   - Frameworks (React Router, Prisma, etc.)
 *   - Build tools (Vite, Webpack, etc.)
 *   - Testing frameworks (Playwright, Vitest, etc.)
 *   - Database technologies (Prisma, SQLite, etc.)
 *   - Styling frameworks (Tailwind CSS, etc.)
 *   - Authentication systems
 *   - Utility libraries (@epic-web/*, etc.)
 * 
 * Author: Generated for music-library project
 * Version: 2.0.0
 */

import fs from 'fs';
import path from 'path';

// const __filename = fileURLToPath(import.meta.url);
// const ignoredDirname = path.dirname(__filename);

// AI-powered library detection using OpenAI, Anthropic, or Google APIs
async function analyzeFileWithAI(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const fileName = path.basename(filePath);
    
    // Use Cursor's AI to analyze the file
    // This would be called through Cursor's AI interface
    console.log(`\n🤖 AI Analysis for ${fileName}:`);
    console.log('='.repeat(50));
    
    // Try different AI providers in order of preference
    let libraries = [];
    
    // Try OpenAI first
    if (process.env.OPENAI_API_KEY) {
      console.log('Using OpenAI API...');
      libraries = await analyzeWithOpenAI(content, fileName);
      if (libraries.length === 0) {
        console.log('OpenAI API failed, falling back to pattern matching...');
        libraries = await analyzeWithPatterns(content, fileName);
      }
    }
    // Try Anthropic Claude
    else if (process.env.ANTHROPIC_API_KEY) {
      console.log('Using Anthropic Claude API...');
      libraries = await analyzeWithAnthropic(content, fileName);
      if (libraries.length === 0) {
        console.log('Anthropic API failed, falling back to pattern matching...');
        libraries = await analyzeWithPatterns(content, fileName);
      }
    }
    // Try Google Gemini
    else if (process.env.GOOGLE_API_KEY) {
      console.log('Using Google Gemini API...');
      libraries = await analyzeWithGoogle(content, fileName);
      if (libraries.length === 0) {
        console.log('Google API failed, falling back to pattern matching...');
        libraries = await analyzeWithPatterns(content, fileName);
      }
    }
    // Fallback to enhanced pattern matching
    else {
      console.log('No AI API keys found, using enhanced pattern matching...');
      libraries = await analyzeWithPatterns(content, fileName);
    }
    
    console.log(`Found ${libraries.length} libraries with AI:`);
    libraries.forEach(lib => console.log(`  ✅ ${lib}`));
    console.log('='.repeat(50));
    
    return libraries;
    
  } catch (error) {
    console.error(`Error analyzing file with AI:`, error.message);
    return [];
  }
}

// OpenAI API integration
async function analyzeWithOpenAI(content, fileName) {
  const prompt = `Analyze this file and identify all libraries, frameworks, and technologies that would benefit from Context7 documentation.

File: ${fileName}
Content:
\`\`\`
${content.substring(0, 4000)}
\`\`\`

Please return ONLY a JSON array of library names that would be useful for Context7 documentation. 

IMPORTANT: Be comprehensive and detect ALL relevant technologies, not just the most obvious ones. Look for:

- Imported packages and dependencies (even if only used once)
- APIs being used (Fetch API, Web APIs, etc.)
- Frameworks detected (React Router, Prisma, etc.)
- Configuration technologies (Fly.io, Docker, etc.)
- Testing frameworks (Playwright, Vitest, etc.)
- Build tools (Vite, React Router Dev, etc.)
- Database technologies (Prisma, SQLite, etc.)
- Authentication systems
- Styling frameworks (Tailwind CSS, CSS-in-JS, etc.)
- UI libraries and frameworks (NOT individual components like Button, DropdownMenu, etc.)
- Validation libraries (Zod, etc.)
- Utility libraries (@epic-web/*, etc.)
- Any other relevant libraries or platforms

DO NOT include individual UI components like Button, DropdownMenu, Form, Icon, etc. - these are internal components, not libraries.

For React/JSX files: Always include "React" as it's fundamental to the file.
For files with Tailwind classes: Always include "Tailwind CSS".
For TypeScript files: Consider including "TypeScript" if heavily used.

IMPORTANT: For configuration files like fly.toml, dockerfile, etc., identify the deployment platform (Fly.io, Docker, etc.)

Example response: ["React Router", "Prisma", "AWS S3", "Zod", "Fly.io", "@epic-web/invariant", "Playwright", "Vite", "Tailwind CSS", "Sentry", "React", "TypeScript"]

Return only the JSON array, no other text.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 500,
    }),
  });

  const data = await response.json();
  
  if (!response.ok) {
    console.error('OpenAI API error:', data);
    if (data.error?.code === 'invalid_api_key') {
      console.error('❌ Invalid OpenAI API key. Please check your OPENAI_API_KEY environment variable.');
      console.error('   Get your API key from: https://platform.openai.com/account/api-keys');
    }
    return [];
  }
  
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    console.error('Unexpected OpenAI response structure:', data);
    return [];
  }
  
  const aiResponse = data.choices[0].message.content.trim();
  
  try {
    // Clean up the response - remove markdown code blocks if present
    const cleanedResponse = aiResponse
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    const libraries = JSON.parse(cleanedResponse);
    return Array.isArray(libraries) ? libraries : [];
  } catch (parseError) {
    console.error('Failed to parse OpenAI response:', aiResponse);
    console.error('Parse error:', parseError.message);
    return [];
  }
}

// Anthropic Claude API integration
async function analyzeWithAnthropic(content, fileName) {
  const prompt = `Analyze this file and identify all libraries, frameworks, and technologies that would benefit from Context7 documentation.

File: ${fileName}
Content:
\`\`\`
${content.substring(0, 4000)}
\`\`\`

Please return ONLY a JSON array of library names that would be useful for Context7 documentation. 

IMPORTANT: Be comprehensive and detect ALL relevant technologies, not just the most obvious ones. Look for:

- Imported packages and dependencies (even if only used once)
- APIs being used (Fetch API, Web APIs, etc.)
- Frameworks detected (React Router, Prisma, etc.)
- Configuration technologies (Fly.io, Docker, etc.)
- Testing frameworks (Playwright, Vitest, etc.)
- Build tools (Vite, React Router Dev, etc.)
- Database technologies (Prisma, SQLite, etc.)
- Authentication systems
- Styling frameworks (Tailwind CSS, CSS-in-JS, etc.)
- UI libraries and frameworks (NOT individual components like Button, DropdownMenu, etc.)
- Validation libraries (Zod, etc.)
- Utility libraries (@epic-web/*, etc.)
- Any other relevant libraries or platforms

DO NOT include individual UI components like Button, DropdownMenu, Form, Icon, etc. - these are internal components, not libraries.

For React/JSX files: Always include "React" as it's fundamental to the file.
For files with Tailwind classes: Always include "Tailwind CSS".
For TypeScript files: Consider including "TypeScript" if heavily used.

IMPORTANT: For configuration files like fly.toml, dockerfile, etc., identify the deployment platform (Fly.io, Docker, etc.)

Example response: ["React Router", "Prisma", "AWS S3", "Zod", "Fly.io", "@epic-web/invariant", "Playwright", "Vite", "Tailwind CSS", "Sentry", "React", "TypeScript"]

Return only the JSON array, no other text.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json();
  
  if (!response.ok) {
    console.error('Anthropic API error:', data);
    if (data.error?.type === 'authentication_error') {
      console.error('❌ Invalid Anthropic API key. Please check your ANTHROPIC_API_KEY environment variable.');
      console.error('   Get your API key from: https://console.anthropic.com/');
    }
    return [];
  }
  
  const aiResponse = data.content[0].text.trim();
  
  try {
    // Clean up the response - remove markdown code blocks if present
    const cleanedResponse = aiResponse
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    const libraries = JSON.parse(cleanedResponse);
    return Array.isArray(libraries) ? libraries : [];
  } catch {
    console.error('Failed to parse Anthropic response:', aiResponse);
    return [];
  }
}

// Google Gemini API integration
async function analyzeWithGoogle(content, fileName) {
  const prompt = `Analyze this file and identify all libraries, frameworks, and technologies that would benefit from Context7 documentation.

File: ${fileName}
Content:
\`\`\`
${content.substring(0, 4000)}
\`\`\`

Please return ONLY a JSON array of library names that would be useful for Context7 documentation. 

IMPORTANT: Be comprehensive and detect ALL relevant technologies, not just the most obvious ones. Look for:

- Imported packages and dependencies (even if only used once)
- APIs being used (Fetch API, Web APIs, etc.)
- Frameworks detected (React Router, Prisma, etc.)
- Configuration technologies (Fly.io, Docker, etc.)
- Testing frameworks (Playwright, Vitest, etc.)
- Build tools (Vite, React Router Dev, etc.)
- Database technologies (Prisma, SQLite, etc.)
- Authentication systems
- Styling frameworks (Tailwind CSS, CSS-in-JS, etc.)
- UI libraries and frameworks (NOT individual components like Button, DropdownMenu, etc.)
- Validation libraries (Zod, etc.)
- Utility libraries (@epic-web/*, etc.)
- Any other relevant libraries or platforms

DO NOT include individual UI components like Button, DropdownMenu, Form, Icon, etc. - these are internal components, not libraries.

For React/JSX files: Always include "React" as it's fundamental to the file.
For files with Tailwind classes: Always include "Tailwind CSS".
For TypeScript files: Consider including "TypeScript" if heavily used.

IMPORTANT: For configuration files like fly.toml, dockerfile, etc., identify the deployment platform (Fly.io, Docker, etc.)

Example response: ["React Router", "Prisma", "AWS S3", "Zod", "Fly.io", "@epic-web/invariant", "Playwright", "Vite", "Tailwind CSS", "Sentry", "React", "TypeScript"]

Return only the JSON array, no other text.`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 500,
      }
    }),
  });

  const data = await response.json();
  
  if (!response.ok) {
    console.error('Google API error:', data);
    if (data.error?.message?.includes('API_KEY_INVALID')) {
      console.error('❌ Invalid Google API key. Please check your GOOGLE_API_KEY environment variable.');
      console.error('   Get your API key from: https://makersuite.google.com/app/apikey');
    }
    return [];
  }
  
  const aiResponse = data.candidates[0].content.parts[0].text.trim();
  
  try {
    // Clean up the response - remove markdown code blocks if present
    const cleanedResponse = aiResponse
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    const libraries = JSON.parse(cleanedResponse);
    return Array.isArray(libraries) ? libraries : [];
  } catch (parseError) {
    console.error('Failed to parse Google response:', aiResponse);
    console.error('Parse error:', parseError.message);
    return [];
  }
}

// Enhanced pattern matching fallback
async function analyzeWithPatterns(content, _fileName) {
  const libraries = new Set();
  
  // Enhanced import analysis
  const importRegex = /import\s+.*?\s+from\s+['"`]([^'"`]+)['"`]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];
    if (!importPath.startsWith('.') && !importPath.startsWith('#') && !importPath.startsWith('@/')) {
      const libName = convertToLibraryName(importPath);
      if (libName) libraries.add(libName);
    }
  }
  
  // Enhanced pattern detection
  const patterns = [
    { pattern: /fetch\s*\(|Response\s*\(|new\s+Response/, name: 'Fetch API' },
    { pattern: /prisma|Prisma/, name: 'Prisma' },
    { pattern: /react-router|React Router/, name: 'React Router' },
    { pattern: /zod|Zod/, name: 'Zod' },
    { pattern: /aws-sdk|AWS|S3|s3/, name: 'AWS SDK' },
    { pattern: /tailwind|Tailwind/, name: 'Tailwind CSS' },
    { pattern: /typescript|TypeScript/, name: 'TypeScript' },
    { pattern: /vite|Vite/, name: 'Vite' },
    { pattern: /playwright|Playwright/, name: 'Playwright' },
    { pattern: /jest|Jest/, name: 'Jest' },
  ];
  
  for (const { pattern, name } of patterns) {
    if (pattern.test(content)) {
      libraries.add(name);
    }
  }
  
  return Array.from(libraries);
}

function convertToLibraryName(importPath) {
  const packageName = importPath.split('/')[0];
  
  // Filter out internal components and UI library components
  const internalComponents = [
    'Button', 'DropdownMenu', 'DropdownMenuContent', 'DropdownMenuItem', 
    'DropdownMenuPortal', 'DropdownMenuTrigger', 'Form', 'Icon', 'Input',
    'Label', 'Select', 'Textarea', 'Card', 'Dialog', 'Sheet', 'Tabs',
    'Accordion', 'Alert', 'Badge', 'Breadcrumb', 'Calendar', 'Carousel',
    'Checkbox', 'Collapsible', 'Command', 'ContextMenu', 'DataTable',
    'DatePicker', 'Drawer', 'Dropdown', 'HoverCard', 'Menubar', 'NavigationMenu',
    'Pagination', 'Popover', 'Progress', 'RadioGroup', 'Resizable', 'ScrollArea',
    'Separator', 'Skeleton', 'Slider', 'Sonner', 'Switch', 'Table', 'Toast',
    'Toggle', 'ToggleGroup', 'Tooltip', 'Avatar', 'AvatarFallback', 'AvatarImage'
  ];
  
  // Skip if it's an internal component
  if (internalComponents.includes(packageName)) {
    return null;
  }
  
  if (packageName.startsWith('@')) {
    const scope = packageName.split('/')[0].substring(1);
    const pkg = packageName.split('/')[1];
    return `${scope.charAt(0).toUpperCase() + scope.slice(1)} ${pkg.charAt(0).toUpperCase() + pkg.slice(1)}`;
  }
  
  return packageName
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Main analysis function - uses enhanced analysis
async function analyzeFile(filePath) {
  console.log('Using enhanced analysis...');
  return await analyzeFileWithAI(filePath);
}


function generatePrompt(libraries, fileName) {
  // Sort libraries alphabetically for consistency
  const sortedLibraries = libraries.sort();
  
  let prompt = `Before answering my question, MANDATORY use Context7 to fetch documentation for:\n\n`;
  
  // Add all libraries
  sortedLibraries.forEach(lib => {
    prompt += `- ${lib}\n`;
  });
  
  prompt += `\nContext7 Instructions:\n`;
  
  sortedLibraries.forEach(lib => {
    prompt += `- resolve-library-id: ${lib}\n`;
    prompt += `- get-library-docs: [resolved-id] (focus: ${getDynamicFocusTopics(lib, fileName)})\n`;
  });
  
  prompt += `\n⚠️  DO NOT PROCEED WITHOUT FETCHING ALL DOCUMENTATION ABOVE!\n\n`;
  prompt += `My question: [YOUR QUESTION HERE]`;
  
  return prompt;
}

function getDynamicFocusTopics(library, fileName) {
  // Read the file content to determine focus topics
  try {
    const content = fs.readFileSync(fileName, 'utf8');
    const focusTopics = [];
    
    // Analyze content for specific patterns related to this library
    // This is completely dynamic - no hardcoded mappings!
    
    // Extract common patterns from the content
    const patterns = [
      // Function patterns
      { pattern: /function\s+\w+|const\s+\w+\s*=\s*\(/, name: 'functions' },
      { pattern: /class\s+\w+/, name: 'classes' },
      { pattern: /interface\s+\w+|type\s+\w+/, name: 'types' },
      
      // API patterns
      { pattern: /\.get\(|\.post\(|\.put\(|\.delete\(/, name: 'HTTP methods' },
      { pattern: /\.findMany|\.findFirst|\.create|\.update|\.delete/, name: 'database operations' },
      { pattern: /\.parse|\.validate|\.schema/, name: 'validation' },
      
      // Configuration patterns
      { pattern: /config|settings|options/, name: 'configuration' },
      { pattern: /middleware|plugin|extension/, name: 'extensions' },
      
      // Error handling
      { pattern: /try\s*\{|catch\s*\(|throw\s+new/, name: 'error handling' },
      
      // Async patterns
      { pattern: /async|await|Promise/, name: 'async operations' },
      
      // File operations
      { pattern: /readFile|writeFile|upload|download/, name: 'file operations' },
      
      // Authentication
      { pattern: /login|logout|session|token/, name: 'authentication' },
      
      // Security
      { pattern: /hash|encrypt|decrypt|sign|verify/, name: 'security' },
    ];
    
    for (const { pattern, name } of patterns) {
      if (pattern.test(content)) {
        focusTopics.push(name);
      }
    }
    
    // If no specific patterns found, use general topics
    if (focusTopics.length === 0) {
      focusTopics.push('general usage', 'API reference', 'best practices');
    }
    
    return focusTopics.join(', ');
  } catch {
    return 'general usage';
  }
}

// Add Context7 prompt as a header comment to the file
async function addHeaderToFile(filePath, libraries) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const fileExtension = path.extname(filePath);
    
    // Determine comment style based on file extension
    let commentStyle;
    switch (fileExtension) {
      case '.js':
      case '.jsx':
      case '.ts':
      case '.tsx':
      case '.vue':
      case '.svelte':
        commentStyle = '/*';
        break;
      case '.py':
        commentStyle = '#';
        break;
      case '.rb':
        commentStyle = '#';
        break;
      case '.go':
        commentStyle = '//';
        break;
      case '.rs':
        commentStyle = '//';
        break;
      case '.java':
        commentStyle = '//';
        break;
      case '.cs':
        commentStyle = '//';
        break;
      case '.cpp':
      case '.c':
      case '.h':
        commentStyle = '//';
        break;
      case '.html':
      case '.htm':
        commentStyle = '<!--';
        break;
      case '.css':
      case '.scss':
      case '.sass':
        commentStyle = '/*';
        break;
      default:
        commentStyle = '//';
    }
    
    // Generate simple context7 line
    const context7Line = generateContext7Line(libraries, commentStyle);
    
    // Generate full Context7 prompt
    const prompt = generatePrompt(libraries, path.basename(filePath));
    const headerComment = generateHeaderComment(prompt, path.basename(filePath), commentStyle);
    
    // Check if context7 line already exists (avoid duplicates)
    if (content.includes('@context7:')) {
      console.log('⚠️  @context7 line already exists in file, skipping...');
      return;
    }
    
    // Add both context7 line and full prompt to the beginning of the file
    const newContent = context7Line + '\n' + headerComment + '\n' + content;
    
    // Write back to file
    fs.writeFileSync(filePath, newContent, 'utf8');
    
    console.log('✅ @context7 line added to file!');
    
  } catch (error) {
    console.error('❌ Error adding @context7 line to file:', error.message);
  }
}

// Generate simple @context7 line
function generateContext7Line(libraries, commentStyle) {
  if (libraries.length === 0) {
    return `${commentStyle} @context7:`;
  }
  
  const libraryNames = libraries.join(', ');
  
  if (commentStyle === '/*') {
    return `// @context7: ${libraryNames}`;
  } else {
    return `${commentStyle} @context7: ${libraryNames}`;
  }
}

// Generate formatted header comment in the style of prompt.txt
function generateHeaderComment(prompt, fileName, commentStyle) {
  const lines = prompt.split('\n');
  const header = [];
  
  if (commentStyle === '<!--') {
    // HTML comment style
    header.push('<!--');
    header.push('    Before answering my question, MANDATORY use Context7 to fetch documentation for:');
    header.push('');
    lines.forEach(line => {
      if (line.trim() && line.includes('- ')) {
        header.push('    ' + line);
      }
    });
    header.push('');
    header.push('    Context7 Instructions:');
    lines.forEach(line => {
      if (line.trim() && (line.includes('resolve-library-id:') || line.includes('get-library-docs:'))) {
        header.push('    ' + line);
      }
    });
    header.push('');
    header.push('    ⚠️  DO NOT PROCEED WITHOUT FETCHING ALL DOCUMENTATION ABOVE!');
    header.push('-->');
  } else if (commentStyle === '/*') {
    // CSS comment style - match prompt.txt format
    header.push('/* ');
    header.push('    Before answering my question, MANDATORY use Context7 to fetch documentation for:');
    header.push('');
    lines.forEach(line => {
      if (line.trim() && line.includes('- ')) {
        header.push('    ' + line);
      }
    });
    header.push('');
    header.push('    Context7 Instructions:');
    lines.forEach(line => {
      if (line.trim() && (line.includes('resolve-library-id:') || line.includes('get-library-docs:'))) {
        header.push('    ' + line);
      }
    });
    header.push('');
    header.push('    ⚠️  DO NOT PROCEED WITHOUT FETCHING ALL DOCUMENTATION ABOVE!');
    header.push('*/');
  } else {
    // Single line comment style (//, #)
    header.push(commentStyle + ' Before answering my question, MANDATORY use Context7 to fetch documentation for:');
    header.push(commentStyle + '');
    lines.forEach(line => {
      if (line.trim() && line.includes('- ')) {
        header.push(commentStyle + ' ' + line);
      }
    });
    header.push(commentStyle + '');
    header.push(commentStyle + ' Context7 Instructions:');
    lines.forEach(line => {
      if (line.trim() && (line.includes('resolve-library-id:') || line.includes('get-library-docs:'))) {
        header.push(commentStyle + ' ' + line);
      }
    });
    header.push(commentStyle + '');
    header.push(commentStyle + ' ⚠️  DO NOT PROCEED WITHOUT FETCHING ALL DOCUMENTATION ABOVE!');
  }
  
  return header.join('\n');
}

// Main execution
async function main() {
  const filePath = process.argv[2];
  
  if (!filePath) {
    console.log('Usage: node generate-context7-prompt.js <file-path>');
    console.log('Example: node generate-context7-prompt.js app/routes/resources+/audio.tsx');
    console.log('');
    console.log('Environment Variables (optional):');
    console.log('  OPENAI_API_KEY    - OpenAI API key for GPT-4 analysis');
    console.log('  ANTHROPIC_API_KEY - Anthropic API key for Claude analysis');
    console.log('  GOOGLE_API_KEY    - Google API key for Gemini analysis');
    console.log('');
    console.log('If no API keys are provided, the script will use pattern-based analysis.');
    process.exit(1);
  }
  
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }
  
  console.log(`🔍 Analyzing file: ${filePath}`);
  const libraries = await analyzeFile(filePath);
  
  if (libraries.length === 0) {
    console.log('⚠️  No relevant libraries found in the file.');
    console.log('   This might happen if the file contains only basic code or comments.');
    process.exit(0);
  }
  
  console.log(`✅ Found ${libraries.length} relevant libraries:`);
  libraries.forEach(lib => console.log(`  - ${lib}`));
  
  const prompt = generatePrompt(libraries, path.basename(filePath));
  
  console.log('\n' + '='.repeat(80));
  console.log('CONTEXT7 PROMPT:');
  console.log('='.repeat(80));
  console.log(prompt);
  console.log('='.repeat(80));
  
  // Ask user if they want to add the @context7 line to the file
  console.log('\n📝 Adding @context7 line to the file...');
  console.log('   This will insert the @context7 directive at the top of the file for easy reference.');
  
  // For now, let's add it automatically (you can make this interactive later)
  await addHeaderToFile(filePath, libraries);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { analyzeFile, generatePrompt };
