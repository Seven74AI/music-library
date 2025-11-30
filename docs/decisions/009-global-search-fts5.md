# 009. Global Search System with FTS5

## Status
Accepted

## Context
We need a performant search system that allows users to search across tracks, albums, and artists simultaneously. The system must:
- Handle thousands of entities efficiently
- Provide fast typeahead/search-as-you-type behavior
- Support prefix matching (e.g., "m" matches "meryl")
- Return relevant results with proper ranking
- Be secure against SQL injection and DoS attacks

## Decision
We will implement a global search system using SQLite FTS5 (Full-Text Search 5) with:
- FTS5 virtual tables for tracks, albums, and artists
- Automatic synchronization via database triggers
- Prefix matching for typeahead support
- Relevance ranking (exact > prefix > contains)
- Comprehensive input validation and security measures

## Implementation Details

### Database Layer
- **FTS5 Virtual Tables**: Three virtual tables (`tracks_fts`, `albums_fts`, `artists_fts`) that index searchable content
- **Trigger-Based Sync**: Automatic INSERT/UPDATE/DELETE triggers keep FTS5 tables synchronized with main tables
- **Unicode61 Tokenizer**: Supports international characters and accents
- **Standalone Tables**: Use explicit ID columns instead of `content_rowid` (since we use TEXT/CUID IDs, not INTEGER)

### Search Strategy
1. **Prefix Queries**: FTS5 native `*` operator for typeahead (e.g., "m*" matches "meryl", "metal")
2. **Relevance Ranking**: 
   - Exact match (title = query) → rank 1
   - Prefix match (title LIKE 'query%') → rank 2
   - Contains match (FTS5 match) → rank 3
   - Combined with FTS5's BM25 ranking for fine-grained ordering
3. **Cursor-Based Pagination**: Efficient pagination using entity IDs

### Security Measures
- **Input Validation**: Zod schemas validate query length (max 200 chars), word count (max 20), and format
- **SQL Injection Prevention**: Comprehensive escaping of FTS5 special characters (", ', \, ?, *, AND, OR, NOT)
- **DoS Prevention**: Query length and word count limits prevent expensive queries
- **XSS Protection**: React's automatic escaping for all user input in UI
- **Error Handling**: Sanitized error messages that don't expose internal details

### API Design
- **Endpoint**: `GET /api/search?q={query}&type={all|tracks|albums|artists}&limit={1-100}&cursor={string}`
- **Response**: JSON with results array and pagination metadata
- **Caching**: Search results cached for 5-10 minutes using `@epic-web/cachified`

### Frontend Components
- **SearchBar**: Enhanced to support global search with type selector
- **SearchResults**: Unified display component for tracks, albums, and artists
- **Search Page**: Full-page search interface at `/search`

## Alternatives Considered

### 1. Hybrid Search (In-Memory Prefix Index + FTS5)
**Pros**: Ultra-fast typeahead, minimal DB work
**Cons**: Memory overhead, complexity, marginal gains for "thousands" of entities
**Decision**: Start with pure FTS5 for simplicity. Architecture allows easy migration to hybrid if needed.

### 2. External Search Service (Meilisearch, Typesense)
**Pros**: Advanced features (fuzzy matching, typo tolerance), better for 100k+ entities
**Cons**: External dependency, additional infrastructure, overkill for current scale
**Decision**: SQLite FTS5 is sufficient for thousands of entities and keeps the stack simple.

### 3. Simple LIKE Queries
**Pros**: Simple implementation
**Cons**: Poor performance, no ranking, no prefix optimization
**Decision**: FTS5 provides better performance and relevance ranking.

## Consequences

### Positive
- ✅ Fast search performance (<50ms for typical queries)
- ✅ Native SQLite feature, no external dependencies
- ✅ Automatic synchronization via triggers
- ✅ Secure by design with comprehensive validation
- ✅ Easy to extend (clear path to hybrid search if needed)
- ✅ Good international character support (Unicode61)

### Negative
- ⚠️ FTS5 MATCH queries cannot be parameterized (requires string embedding)
- ⚠️ Requires careful escaping to prevent SQL injection
- ⚠️ May need hybrid approach if scaling to 100k+ entities

### Migration Path
The architecture is designed to easily add a hybrid in-memory prefix index layer:
1. FTS5 layer stays unchanged
2. Add prefix index service that builds on server startup
3. Update search service to optionally filter by prefix index before FTS5 query
4. No breaking changes to existing FTS5 queries

## References
- [SQLite FTS5 Documentation](https://www.sqlite.org/fts5.html)
- [FTS5 Query Syntax](https://www.sqlite.org/fts5.html#fts5_query_syntax)
- Migration: `prisma/migrations/20251204000000_add_fts5_search/migration.sql`
- Implementation: `app/utils/search.server.ts`
- Security: `app/utils/search-validation.server.ts`

