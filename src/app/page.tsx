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
    <div className="min-h-screen">
      <AnimatePresence mode="wait">
        {stage === "verify" && (
          <motion.div
            key="verify"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <VerifyPage onVerified={handleVerified} />
          </motion.div>
        )}

        {stage === "upload" && session && (
          <motion.div
            key="upload"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="min-h-screen bg-[#faf5f3] flex flex-col items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
              className="w-16 h-16 mb-6 rounded-full bg-emerald-500 flex items-center justify-center"
            >
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </motion.div>
            
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-center max-w-xs"
            >
              <h1 className="text-2xl font-semibold text-neutral-900 mb-2">
                All done!
              </h1>
              <p className="text-sm text-neutral-500 mb-8">
                {uploadResult.itemCount} item{uploadResult.itemCount !== 1 ? "s" : ""} with{" "}
                {uploadResult.photoCount} photo{uploadResult.photoCount !== 1 ? "s" : ""} sent to Fitted
              </p>

              <button
                onClick={handleReset}
                className="w-full h-12 bg-neutral-900 text-white text-sm font-medium rounded-xl hover:bg-neutral-800 transition-colors"
              >
                Next customer
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
