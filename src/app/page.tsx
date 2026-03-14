"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import VerifyPage from "@/components/VerifyPage";
import UploadPage from "@/components/UploadPage";

export type AppStage = "verify" | "upload" | "success";

export interface VerifiedSession {
  taskRabbitId: string;
  customerName?: string;
}

export default function App() {
  const [stage, setStage] = useState<AppStage>("verify");
  const [session, setSession] = useState<VerifiedSession | null>(null);
  const [uploadResult, setUploadResult] = useState<{
    itemCount: number;
    photoCount: number;
  } | null>(null);

  const handleVerified = (data: VerifiedSession) => {
    setSession(data);
    setStage("upload");
  };

  const handleComplete = (result: { itemCount: number; photoCount: number }) => {
    setUploadResult(result);
    setStage("success");
  };

  const handleReset = () => {
    setSession(null);
    setUploadResult(null);
    setStage("verify");
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <AnimatePresence mode="wait">
        {stage === "verify" && (
          <motion.div
            key="verify"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            <VerifyPage onVerified={handleVerified} />
          </motion.div>
        )}

        {stage === "upload" && session && (
          <motion.div
            key="upload"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            <UploadPage
              session={session}
              onComplete={handleComplete}
              onBack={() => setStage("verify")}
            />
          </motion.div>
        )}

        {stage === "success" && uploadResult && (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
            className="min-h-screen flex items-center justify-center p-6"
          >
            <div className="max-w-md w-full text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                className="w-20 h-20 mx-auto mb-8 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center"
              >
                <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </motion.div>
              
              <h1 className="text-3xl font-bold mb-3">Upload Complete</h1>
              <p className="text-zinc-400 text-lg mb-8">
                {uploadResult.itemCount} item{uploadResult.itemCount !== 1 ? "s" : ""} with{" "}
                {uploadResult.photoCount} photo{uploadResult.photoCount !== 1 ? "s" : ""} sent to Fitted
              </p>

              <button
                onClick={handleReset}
                className="w-full py-4 bg-white text-zinc-900 font-semibold rounded-2xl hover:bg-zinc-100 transition-colors"
              >
                Process Next Customer
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
