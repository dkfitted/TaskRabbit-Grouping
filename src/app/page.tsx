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
            className="min-h-screen flex flex-col"
          >
            {/* Ambient glow */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
              <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-[radial-gradient(ellipse_at_center,rgba(34,197,94,0.12),transparent_60%)]" />
            </div>

            <div className="relative z-10 flex-1 flex items-center justify-center p-6">
              <div className="max-w-sm w-full text-center">
                {/* Success icon */}
                <motion.div
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ 
                    type: "spring", 
                    stiffness: 200, 
                    damping: 15,
                    delay: 0.1 
                  }}
                  className="w-20 h-20 mx-auto mb-8 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/25"
                >
                  <motion.svg 
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ delay: 0.4, duration: 0.4 }}
                    className="w-10 h-10 text-white" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth={3}
                    viewBox="0 0 24 24"
                  >
                    <motion.path 
                      strokeLinecap="round" 
                      strokeLinejoin="round" 
                      d="M5 13l4 4L19 7" 
                    />
                  </motion.svg>
                </motion.div>
                
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <h1 className="text-[28px] font-semibold tracking-tight mb-3">
                    Upload Complete
                  </h1>
                  <p className="text-[16px] text-[#888] mb-10">
                    {uploadResult.itemCount} item{uploadResult.itemCount !== 1 ? "s" : ""} with{" "}
                    {uploadResult.photoCount} photo{uploadResult.photoCount !== 1 ? "s" : ""} sent to Fitted
                  </p>

                  <button
                    onClick={handleReset}
                    className="btn btn-primary w-full h-12 rounded-xl text-[15px] font-medium"
                  >
                    Process Next Customer
                  </button>
                </motion.div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
