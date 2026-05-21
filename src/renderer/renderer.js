import { mount } from 'svelte';
import App from './App.svelte';
import './styles.css'; // Import styles.css to include it in the bundle

const target = document.getElementById('app');
if (!target) {
  throw new Error('Target element #app not found');
}

const app = mount(App, {
  target: target,
});