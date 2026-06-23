# DiagramTalk Project Brief

## Goal

DiagramTalk is an experimental interactive whiteboard where a human and an LLM can discuss what is being drawn.

The core idea is to let the user point at, select, or reference parts of a diagram and ask natural-language questions about them. The LLM should understand enough of the drawing context to respond usefully.

Example:

> "Do you think this link is correct?"

In that case, the system should know which link the user is referring to, what it connects, and what surrounding diagram elements may be relevant.

## Core Experience

The first version should focus on a simple loop:

1. The user draws or edits a diagram on a whiteboard.
2. The user selects an element, such as a box, arrow, link, label, or group.
3. The user asks the LLM a question about the selected element or the whole diagram.
4. The app sends the relevant diagram context to the LLM.
5. The LLM answers in chat, ideally referring back to the selected element and nearby context.

The product should feel less like a generic chatbot beside a canvas and more like a collaborator that can talk about the actual diagram.

## Likely Foundation

[tldraw](https://www.tldraw.com/) looks like the best starting point for the whiteboard layer. It already provides drawing, selection, shape editing, arrows, text, and interaction primitives.

The project should build on top of tldraw rather than recreating a canvas editor from scratch.

## LLM Integration

The LLM should be reachable through an API key. OpenRouter is the initial provider assumption.

The app should eventually support sending structured diagram context rather than only screenshots or raw text. Useful context may include:

- selected shape metadata
- connected shapes
- nearby labels
- arrows and relationships
- current user question
- optionally, a broader summary of the canvas

## Important Product Questions

- What should be sent to the LLM: structured tldraw state, a screenshot, or both?
- How much surrounding diagram context is needed for good answers?
- Should the LLM only answer in chat, or should it be able to suggest edits directly on the canvas?
- Should users approve any LLM-generated diagram changes before they are applied?
- Should the conversation be attached to the whole canvas, to selected elements, or both?

## First Milestone

Build a minimal prototype with:

- a tldraw canvas
- a chat panel
- access to the currently selected shape
- an OpenRouter-backed LLM call
- a prompt that includes the selected shape and the user's question

This is enough to validate the central interaction: asking an LLM about something specific in a diagram.

## Design Principle

DiagramTalk should make the diagram the primary object of conversation.

The chat should not be an isolated assistant. It should be grounded in what the user selected, drew, connected, and changed.
