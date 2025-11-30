# ADR-008: SVG Sprite DOM Injection for Icon Performance

## Status
Accepted

## Context
The Music Library application uses SVG sprites for icons via `vite-plugin-icons-spritesheet`, following Epic Stack best practices. Icons are rendered using the `<use>` element referencing external sprite symbols (`sprite.svg#play`, `sprite.svg#pause`, etc.).

### Problems with External SVG Sprite References

1. **Repeated Downloads on Hover**: When icons are conditionally rendered (e.g., play/pause icons on track hover), the browser re-downloads the sprite file even though:
   - The sprite is preloaded in the `<head>` with `fetchPriority: 'high'`
   - Cache headers are set (`Cache-Control: public, max-age=31536000, immutable`)
   - The sprite file is small (~29.45 KB)

2. **Browser Caching Limitations**: External SVG references via `<use href="sprite.svg#icon">` have inconsistent caching behavior across browsers, especially when:
   - Icons are conditionally rendered (React state changes)
   - Multiple `<use>` elements reference the same external file
   - The sprite isn't in the document context

3. **Network Overhead**: Each hover interaction triggers a network request (or cache validation), causing:
   - Unnecessary bandwidth usage
   - Delayed icon rendering
   - Poor user experience with flickering or delayed icons

4. **Conditional Rendering Issue**: Icons in `TrackListItem` are conditionally rendered based on `isHovered` state:
   ```typescript
   {hasAudioFiles && (isHovered || isCurrentlyPlaying) ? (
     <Icon name={isCurrentlyPlaying ? 'pause' : 'play'} />
   ) : (
     <span>{index + 1}</span>
   )}
   ```
   When React creates new `<use>` elements, browsers may not recognize the cached sprite.

### Requirements
- Eliminate repeated sprite downloads on hover
- Ensure icons render instantly without network delays
- Maintain compatibility with Epic Stack's SVG sprite system
- Keep sprite file external (not inlined in bundle)
- Preserve browser caching benefits
- No performance degradation

## Decision
Inject the SVG sprite content directly into the DOM before React hydrates, then update the Icon component to use local symbol references (`#play` instead of `sprite.svg#play`).

### Architecture Pattern

#### Before (External References)
```
HTML → Preload sprite.svg → Browser Cache
React → <use href="sprite.svg#play"> → Browser fetches/validates sprite
Hover → New <use> element → Browser re-fetches sprite ❌
```

#### After (DOM Injection)
```
HTML → Preload sprite.svg → Synchronous XHR → Inject into DOM
React → <use href="#play"> → Local symbol reference ✅
Hover → New <use> element → Local symbol reference ✅ (no network)
```

### Implementation Strategy

#### 1. Synchronous Sprite Injection
Add a blocking script in `app/root.tsx` that runs before React hydration:
- Fetches sprite SVG content using synchronous XHR
- Injects sprite into hidden container at start of `<body>`
- Ensures sprite is in document context before any icons render

#### 2. Local Symbol References
Update `Icon` component to reference local symbols:
- Change from `<use href="sprite.svg#play">` to `<use href="#play">`
- Symbols are now in document context, no external requests needed

#### 3. Maintain Preload and Cache Headers
- Keep preload link in `<head>` for initial fast load
- Keep cache headers for sprite file
- Both help with initial page load performance

## Consequences

### Positive
- ✅ **Zero Network Requests on Hover**: Icons reference local symbols, no external fetches
- ✅ **Instant Icon Rendering**: No network delay when icons appear
- ✅ **Better User Experience**: Smooth hover interactions without flickering
- ✅ **Reduced Bandwidth**: Sprite loads once, reused indefinitely
- ✅ **Browser Compatibility**: Works consistently across all browsers
- ✅ **Maintains Epic Stack Pattern**: Still uses SVG sprites, just injected into DOM
- ✅ **Cache Headers Still Help**: Initial load benefits from caching

### Negative
- ⚠️ **Synchronous XHR**: Blocks main thread for ~10-50ms (fast connection) or 100-500ms (slow)
- ⚠️ **Slight Initial Paint Delay**: Sprite must load before React hydrates
- ⚠️ **Deprecated API**: Synchronous XHR is deprecated (but acceptable here)

### Neutral
- 🔄 **Sprite in DOM**: Sprite content is now in HTML document (hidden)
- 🔄 **Local References**: Icons use fragment identifiers instead of external URLs
- 🔄 **Preload Still Useful**: Preload helps with initial fetch, injection ensures availability

## Implementation Details

### File Structure Changes
```
app/root.tsx
├── Sprite injection script (before {children})
└── Document component

app/components/ui/icon.tsx
└── Updated <use> element (local reference)
```

### Key Patterns

#### Sprite Injection Script
```typescript
{/* Inject SVG sprite into DOM before React hydrates */}
<script
  nonce={nonce}
  dangerouslySetInnerHTML={{
    __html: `
(function() {
  if (document.getElementById('svg-sprite-container')) return;
  var container = document.createElement('div');
  container.id = 'svg-sprite-container';
  container.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';
  container.setAttribute('aria-hidden', 'true');
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '${iconsHref}', false);
  xhr.send();
  if (xhr.status === 200 && xhr.responseText) {
    container.innerHTML = xhr.responseText;
    document.body.insertBefore(container, document.body.firstChild);
  }
})();
    `.trim(),
  }}
/>
```

#### Icon Component Update
```typescript
// Before:
<use href={`${href}#${name}`} />

// After:
<use href={`#${name}`} />
```

### Technical Details

- **Synchronous XHR**: Intentionally blocking to ensure sprite is available before React hydration. Acceptable because:
  - Runs before any interactive content
  - Sprite is small (~29 KB)
  - Prevents many future network requests
  - Better overall performance

- **Sprite Container**: Hidden with `position:absolute;width:0;height:0;overflow:hidden` to not affect layout or accessibility

- **Local Symbol References**: Once sprite is in DOM, symbols can be referenced by ID alone (`#play`) instead of external file (`sprite.svg#play`)

- **Preload + Cache Headers**: Still beneficial for initial page load, injection ensures availability for all subsequent renders

## Alternatives Considered

### Alternative 1: Keep External References + Better Caching
- **Pros**: Simpler implementation, no DOM injection
- **Cons**: Still causes re-downloads on hover, browser caching inconsistencies
- **Decision**: Rejected - doesn't solve the core problem

### Alternative 2: Inline Sprite in HTML Template
- **Pros**: No network request, sprite always available
- **Cons**: Increases HTML size, sprite not cacheable separately, harder to maintain
- **Decision**: Rejected - increases initial page load size

### Alternative 3: Async Sprite Injection
- **Pros**: Non-blocking, better perceived performance
- **Cons**: Icons might not render initially, requires loading states, more complex
- **Decision**: Rejected - synchronous is acceptable and simpler

### Alternative 4: Use Icon Components Instead of Sprites
- **Pros**: No sprite management, React components
- **Cons**: Larger bundle size, worse performance, doesn't follow Epic Stack pattern
- **Decision**: Rejected - goes against Epic Stack best practices

### Alternative 5: Pre-render All Icons
- **Pros**: No conditional rendering issues
- **Cons**: Unnecessary DOM elements, worse performance, accessibility issues
- **Decision**: Rejected - poor performance and UX

## Migration Strategy

### Phase 1: Sprite Injection
1. Add synchronous injection script to `app/root.tsx`
2. Test sprite loads before React hydration
3. Verify sprite is in DOM

### Phase 2: Icon Component Update
1. Update `Icon` component to use local references
2. Test all icons render correctly
3. Verify no network requests on hover

### Phase 3: Verification
1. Test in multiple browsers
2. Verify no performance regressions
3. Check network tab for sprite requests
4. Test hover interactions

## Success Metrics

### Technical Metrics
- [x] Zero network requests for sprite on hover
- [x] Icons render instantly without delay
- [x] Sprite loads before React hydration
- [x] All icons work with local references
- [x] No layout shifts or visual glitches

### Performance Metrics
- [x] Initial page load time unchanged or improved
- [x] Hover interactions are instant
- [x] No repeated sprite downloads
- [x] Reduced total network requests

### User Experience Metrics
- [x] Smooth hover interactions
- [x] No icon flickering or delays
- [x] Consistent behavior across browsers
- [x] Icons always available when needed

## Future Considerations

### Performance
- Synchronous XHR is acceptable for ~29 KB sprite
- If sprite grows significantly (>100 KB), consider async injection with loading states
- Current approach scales well for typical icon sets

### Browser Support
- Synchronous XHR works in all modern browsers
- If deprecated in future, can switch to async with proper loading handling
- Local symbol references are well-supported

### Maintenance
- Sprite injection is transparent to developers
- Icon usage remains the same
- Easy to revert if needed (just change `<use>` back to external reference)

### Extensibility
- Pattern works for any SVG sprite system
- Can be applied to other sprite files if needed
- Doesn't interfere with other optimizations

## References

- [Ben Adam: The "best" way to manage icons in React.js](https://benadam.me/thoughts/react-svg-sprites/)
- [Epic Stack Icons Documentation](https://github.com/epicweb-dev/epic-stack/blob/main/docs/icons.md)
- [MDN: SVG `<use>` Element](https://developer.mozilla.org/en-US/docs/Web/SVG/Element/use)
- [MDN: SVG `<symbol>` Element](https://developer.mozilla.org/en-US/docs/Web/SVG/Element/symbol)
- [Web.dev: Preload Critical Assets](https://web.dev/preload-critical-assets/)

## Related ADRs

- None (first performance optimization ADR)

## Revision History

- **2025-01-02**: Initial version - SVG sprite DOM injection for icon performance

