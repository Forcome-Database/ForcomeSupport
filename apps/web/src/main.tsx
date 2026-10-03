import '@fontsource-variable/inter';
import '@fontsource-variable/noto-sans-sc';
import './styles/globals.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createAppRouter } from './router';

const root = document.getElementById('root');
if (!root) {
  throw new Error('找不到 #root 挂载点');
}

const queryClient = new QueryClient();
const router = createAppRouter(queryClient);

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
