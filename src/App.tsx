import { useState, useCallback } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import HomePage from "./pages/HomePage.tsx";
import Index from "./pages/Index.tsx";
import ArticleDetail from "./pages/ArticleDetail.tsx";
import ReviewDashboard from "./pages/ReviewDashboard.tsx";
import PdfPage from "./pages/PdfPage.tsx";
import PastePage from "./pages/PastePage.tsx";
import UsersPage from "./pages/UsersPage.tsx";
import NotFound from "./pages/NotFound.tsx";
import LoginPage from "./pages/LoginPage.tsx";
import ProtectedRoute from "./components/ProtectedRoute.tsx";
import SplashScreen from "./components/SplashScreen.tsx";
import PushLogPage from "./pages/PushLogPage.tsx";

const queryClient = new QueryClient();

const App = () => {
  const [showSplash, setShowSplash] = useState(true);
  const handleSplashDone = useCallback(() => setShowSplash(false), []);

  return (
    <>
      {showSplash && <SplashScreen onDone={handleSplashDone} />}
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
              <Route path="/scraper" element={<ProtectedRoute><Index /></ProtectedRoute>} />
              <Route path="/article/:id" element={<ProtectedRoute><ArticleDetail /></ProtectedRoute>} />
              <Route path="/review" element={<ProtectedRoute><ReviewDashboard /></ProtectedRoute>} />
              <Route path="/pdf" element={<ProtectedRoute><PdfPage /></ProtectedRoute>} />
              <Route path="/paste" element={<ProtectedRoute><PastePage /></ProtectedRoute>} />
              <Route path="/users" element={<ProtectedRoute><UsersPage /></ProtectedRoute>} />
              <Route path="/push-log" element={<ProtectedRoute><PushLogPage /></ProtectedRoute>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </>
  );
};

export default App;
