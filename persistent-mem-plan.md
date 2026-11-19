Notes for the future persistent memory system. The planned architecture sounds like the right direction.
When you build it, I would think of it as three layers:

```
1. Ephemeral scratchpad
   - conversation-scoped
   - fast
   - disposable
   - useful for plans, intermediate state, notes

2. Persistent user memory
   - explicit facts/preferences the agent should remember
   - semantic RAG retrieval
   - relevance-ranked
   - toggleable

3. Cross-chat memory/search
   - searches previous conversations
   - optionally archived chats
   - relevance-ranked
   - privacy-sensitive
```

The tools above intentionally stay stateless and offline so they can remain useful regardless of how the memory layer evolves.
Later, when you implement persistent memory, tools like:

```
memory_search
memory_set
memory_update
memory_delete
chat_history_search
scratchpad_set
scratchpad_get
```

can sit cleanly alongside these utility tools.
