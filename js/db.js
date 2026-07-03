/**
 * db.js
 * Camada única de acesso ao IndexedDB.
 * Nenhum outro arquivo deve falar com o IndexedDB diretamente —
 * assim, se um dia trocarmos de storage (ex: sincronizar com Supabase
 * no plano Premium), só este arquivo muda.
 */

const DB_NAME = 'estoqueAppDB';
const DB_VERSION = 2;

const STORES = {
  PRODUTOS: 'produtos',
  VENDAS: 'vendas',
  MOVIMENTOS: 'movimentos'
};

let dbInstance = null;

function abrirBanco() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORES.PRODUTOS)) {
        const produtosStore = db.createObjectStore(STORES.PRODUTOS, { keyPath: 'id' });
        produtosStore.createIndex('nome', 'nome', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.VENDAS)) {
        const vendasStore = db.createObjectStore(STORES.VENDAS, { keyPath: 'id' });
        vendasStore.createIndex('data', 'data', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.MOVIMENTOS)) {
        const movStore = db.createObjectStore(STORES.MOVIMENTOS, { keyPath: 'id' });
        movStore.createIndex('data', 'data', { unique: false });
        movStore.createIndex('produtoId', 'produtoId', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

function gerarId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

async function adicionar(storeName, registro) {
  const db = await abrirBanco();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.add(registro);
    request.onsuccess = () => resolve(registro);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function atualizar(storeName, registro) {
  const db = await abrirBanco();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.put(registro);
    request.onsuccess = () => resolve(registro);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function remover(storeName, id) {
  const db = await abrirBanco();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
}

async function listarTodos(storeName) {
  const db = await abrirBanco();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function buscarPorId(storeName, id) {
  const db = await abrirBanco();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = (e) => reject(e.target.error);
  });
}

// Exposto globalmente porque o projeto usa scripts simples (sem bundler),
// mantendo a filosofia de "zero dependências, zero build step".
window.DB = {
  STORES,
  gerarId,
  adicionar,
  atualizar,
  remover,
  listarTodos,
  buscarPorId
};
