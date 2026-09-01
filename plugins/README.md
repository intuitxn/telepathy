# Integration boundary

Plugins may translate Telepathy intent into execution and return candidate artifacts or verified outcomes. They do not define the human product.

Every integration must preserve:

- visible human authorship and ownership;
- source references and exact artifact revisions;
- a review gate before external messages or artifact acceptance;
- provider boundaries instead of direct access to another tool's private state;
- quiet failure states that identify the next human or system action.

Buzz, Codex, OpenCode, Prime Agent, and Agent Manager can participate below this boundary. Their internal messages are not a Telepathy feed.
