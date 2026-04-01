---
name: simplify
trigger: /simplify
description: Review changed code for reuse, quality, and efficiency then fix issues
tools: [read, edit, bash]
---

Review all recently changed code in this session for opportunities to simplify and improve. For each file that was modified:

1. Run `git diff` to see what changed
2. Read the full file for context
3. Look for:
   - **Dead code**: unused imports, unreachable branches, commented-out code
   - **Duplication**: repeated logic that should be a shared function
   - **Over-engineering**: abstractions that serve only one call site, unnecessary indirection, premature generalization
   - **Verbose patterns**: code that could be simpler without losing clarity (e.g., manual loops vs. map/filter, unnecessary temp variables)
   - **Naming**: unclear names that force you to read the implementation
   - **Error handling**: catch blocks that swallow errors silently, redundant null checks
   - **Type complexity**: overly complex generic types that could be simpler

4. For each issue found:
   - Explain what's wrong in one sentence
   - Apply the fix directly using the edit tool
   - Keep fixes minimal -- don't rewrite working code for style preferences

5. After all fixes, run the build/tests if a test command exists to verify nothing broke

Rules:
- Three similar lines of code is better than a premature abstraction
- Don't add docstrings, comments, or type annotations that weren't there before
- Don't refactor working code that wasn't touched in this session
- If code is clear, leave it alone
