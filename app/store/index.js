import Vue from 'vue';
import Vuex from 'vuex';
Vue.use(Vuex);

import BookmarkManager from '../../lib/bookmark-manager.js';
import tidyHelpers from '../../lib/helpers.js'

import ChromePromise from 'chrome-promise';
const chromep = new ChromePromise();

import merge from 'deepmerge';
import packageJson from '../../package.json';

const store = new Vuex.Store({

  state: {
    version: packageJson.version,
    stateVersion: packageJson.version.split('.')[0],
    data: {
      tabGroups: []
    },
    searchQuery: '',
    theme: '',
  },

  actions: {
    async SAVE_TAB_GROUP ({ commit, dispatch }, { filter } = { filter: () => true }) {
      const currentWindow = await chromep.windows.getCurrent({});
      let tabs = await chromep.tabs.getAllInWindow(currentWindow.id);
      tabs = tabs
        .filter(tab => !tidyHelpers.shouldTidy(tab))
        .filter(filter);

      if (tabs.length < 1) return tabs;

      const tidyParent = await BookmarkManager.getTidyParent();
      const tabGroupParent = await chromep.bookmarks.create({
        title: BookmarkManager.newId(),
        parentId: tidyParent.id
      });

      tabs.forEach(async (tab) => {
        await chromep.bookmarks.create({
          parentId: tabGroupParent.id,
          title: tab.title,
          url: tab.url
        });
      });

      return tabs;
      dispatch('HYDRATE_STATE');
    },

    async DELETE_TAB_GROUP ({ commit, dispatch }, dateAdded) {
      await BookmarkManager.removeTabGroup(dateAdded)
      dispatch('HYDRATE_STATE');
    },

    async DELETE_TAB ({ commit, dispatch }, { tabGroup, url }) {
      await BookmarkManager.removeTabFromTabGroup(tabGroup, url)
      dispatch('HYDRATE_STATE');
    },

    async IMPORT_DATA ({ dispatch, commit }, raw) {
      await BookmarkManager.import(raw);
      dispatch('HYDRATE_STATE');
    },

    async HYDRATE_STATE ({ commit }) {
      const tabGroups = await BookmarkManager.tabGroupsFromBookmarks();
      commit('SET_DATA', { tabGroups });

      const items = await chromep.storage.local.get('theme');
      commit('SET_THEME', items.theme || 'light');
    },

    async PRUNE_EMPTY_TAB_GROUPS ({ commit }) {
      await BookmarkManager.pruneEmptyTabGroups();
    },
  },

  mutations: {
    SET_DATA (state, data) {
      state.data = data;
    },

    SET_THEME (state, theme) {
      state.theme = theme;
      chromep.storage.local.set({ theme });
    },

    SET_SEARCH_QUERY (state, query) {
      state.searchQuery = query;
    },
  },

  getters: {
    sortedAndFilteredTabGroups: state => {
      const q = state.searchQuery.toLowerCase();

      const tabGroups = state.data.tabGroups
      .filter(t => t.tabs.length > 0)
      .filter(tabGroup => {
        if (!q.length) return true;

        const hasQuery = tabGroup.tabs.find(tab =>
          tab.title.toLowerCase().includes(q) || tab.url.toLowerCase().includes(q)
        );
        return !!(hasQuery);
      })
      .sort((a, b) => b.dateAdded - a.dateAdded)
      .map(tabGroup => {
        if (!q) return tabGroup;
        tabGroup.tabs = tabGroup.tabs.filter(tab => {
          const doesMatch = tab.title.toLowerCase().includes(q) || tab.url.toLowerCase().includes(q);
          return doesMatch;
        });

        return tabGroup;
      });

      return tabGroups || [];
    },
  }

});

const hydrateAndPrune = async () => {
  await store.dispatch('PRUNE_EMPTY_TAB_GROUPS');
  await store.dispatch('HYDRATE_STATE');
}
hydrateAndPrune();

const bindListeners = async () => {
  const currentTab = await chromep.tabs.getCurrent()

  chrome.tabs.onHighlighted.addListener(changedWindow => {
    if (changedWindow.tabIds[0] !== currentTab.id) return;
    store.dispatch('HYDRATE_STATE');
  });

  window.addEventListener('focus', () => {
    store.dispatch('HYDRATE_STATE');
  });
}

bindListeners();

export default store;
