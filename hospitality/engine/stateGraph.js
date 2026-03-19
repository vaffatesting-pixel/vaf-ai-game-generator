// ─── StateGraph Engine ─────────────────────────────────────────
// LangGraph-inspired cyclic state machine for agentic orchestration.
// Each node is a function that receives state and returns updated state.
// Edges define transitions. Conditional edges allow dynamic routing.

const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');

class StateGraph extends EventEmitter {
  constructor({ name, initialState = {} }) {
    super();
    this.name = name;
    this.nodes = new Map();
    this.edges = new Map();        // node -> next node (static)
    this.conditionalEdges = new Map(); // node -> router function
    this.entryPoint = null;
    this.endNodes = new Set();
    this.initialState = initialState;
    this.maxIterations = 50; // safety: prevent infinite loops
  }

  addNode(name, handler) {
    if (typeof handler !== 'function') throw new Error(`Node "${name}" handler must be a function`);
    this.nodes.set(name, handler);
    return this;
  }

  addEdge(from, to) {
    this.edges.set(from, to);
    return this;
  }

  addConditionalEdge(from, routerFn) {
    if (typeof routerFn !== 'function') throw new Error('Router must be a function');
    this.conditionalEdges.set(from, routerFn);
    return this;
  }

  setEntryPoint(nodeName) {
    this.entryPoint = nodeName;
    return this;
  }

  setEndNode(nodeName) {
    this.endNodes.add(nodeName);
    return this;
  }

  async run(inputState = {}) {
    if (!this.entryPoint) throw new Error('No entry point set');

    const runId = uuidv4();
    const state = {
      ...this.initialState,
      ...inputState,
      _runId: runId,
      _history: [],
      _currentNode: this.entryPoint,
      _status: 'running',
      _startedAt: new Date().toISOString()
    };

    let currentNode = this.entryPoint;
    let iterations = 0;

    this.emit('run:start', { runId, graph: this.name, state });

    while (currentNode && iterations < this.maxIterations) {
      iterations++;

      const handler = this.nodes.get(currentNode);
      if (!handler) throw new Error(`Node "${currentNode}" not found in graph "${this.name}"`);

      state._currentNode = currentNode;
      state._history.push({ node: currentNode, timestamp: new Date().toISOString() });

      this.emit('node:enter', { runId, node: currentNode, state });

      // Check for HITL pause
      if (state._requiresApproval) {
        state._status = 'paused';
        state._pausedAt = currentNode;
        this.emit('run:paused', { runId, node: currentNode, state, reason: state._approvalReason });
        return { state, status: 'paused', pausedAt: currentNode, runId };
      }

      try {
        const result = await handler(state);
        Object.assign(state, result);
      } catch (err) {
        state._status = 'error';
        state._error = err.message;
        this.emit('node:error', { runId, node: currentNode, error: err });
        return { state, status: 'error', errorAt: currentNode, error: err.message, runId };
      }

      this.emit('node:exit', { runId, node: currentNode, state });

      // Check if this is an end node
      if (this.endNodes.has(currentNode)) {
        state._status = 'completed';
        break;
      }

      // Determine next node
      if (this.conditionalEdges.has(currentNode)) {
        const router = this.conditionalEdges.get(currentNode);
        currentNode = await router(state);
      } else if (this.edges.has(currentNode)) {
        currentNode = this.edges.get(currentNode);
      } else {
        // No outgoing edge = implicit end
        state._status = 'completed';
        break;
      }
    }

    if (iterations >= this.maxIterations) {
      state._status = 'max_iterations';
      this.emit('run:max_iterations', { runId, iterations });
    }

    state._completedAt = new Date().toISOString();
    this.emit('run:complete', { runId, graph: this.name, state, iterations });

    return { state, status: state._status, iterations, runId };
  }

  // Resume a paused run (after HITL approval)
  async resume(pausedState, approval = {}) {
    const state = { ...pausedState };
    state._requiresApproval = false;
    state._approvalReason = null;
    state._approval = approval;
    state._status = 'running';

    const resumeFrom = state._pausedAt;
    state._pausedAt = null;

    // Move to the next node after the paused one
    let nextNode;
    if (this.conditionalEdges.has(resumeFrom)) {
      nextNode = await this.conditionalEdges.get(resumeFrom)(state);
    } else if (this.edges.has(resumeFrom)) {
      nextNode = this.edges.get(resumeFrom);
    } else {
      state._status = 'completed';
      return { state, status: 'completed', runId: state._runId };
    }

    state._currentNode = nextNode;
    return this._continueFrom(state, nextNode);
  }

  async _continueFrom(state, startNode) {
    let currentNode = startNode;
    let iterations = 0;

    while (currentNode && iterations < this.maxIterations) {
      iterations++;
      const handler = this.nodes.get(currentNode);
      if (!handler) throw new Error(`Node "${currentNode}" not found`);

      state._currentNode = currentNode;
      state._history.push({ node: currentNode, timestamp: new Date().toISOString() });

      if (state._requiresApproval) {
        state._status = 'paused';
        state._pausedAt = currentNode;
        return { state, status: 'paused', pausedAt: currentNode, runId: state._runId };
      }

      try {
        const result = await handler(state);
        Object.assign(state, result);
      } catch (err) {
        state._status = 'error';
        state._error = err.message;
        return { state, status: 'error', errorAt: currentNode, error: err.message, runId: state._runId };
      }

      if (this.endNodes.has(currentNode)) {
        state._status = 'completed';
        break;
      }

      if (this.conditionalEdges.has(currentNode)) {
        currentNode = await this.conditionalEdges.get(currentNode)(state);
      } else if (this.edges.has(currentNode)) {
        currentNode = this.edges.get(currentNode);
      } else {
        state._status = 'completed';
        break;
      }
    }

    state._completedAt = new Date().toISOString();
    return { state, status: state._status, iterations, runId: state._runId };
  }

  // Serialize graph structure for visualization
  toJSON() {
    const nodes = [];
    const edges = [];

    for (const [name] of this.nodes) {
      nodes.push({
        id: name,
        isEntry: name === this.entryPoint,
        isEnd: this.endNodes.has(name)
      });
    }

    for (const [from, to] of this.edges) {
      edges.push({ from, to, type: 'static' });
    }

    for (const [from] of this.conditionalEdges) {
      edges.push({ from, to: '*', type: 'conditional' });
    }

    return { name: this.name, nodes, edges };
  }
}

// Helper: create a HITL checkpoint in any node handler
function requireApproval(state, reason) {
  state._requiresApproval = true;
  state._approvalReason = reason;
  return state;
}

module.exports = { StateGraph, requireApproval };
