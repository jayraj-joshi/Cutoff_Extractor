import React, { useState, useRef } from 'react';
import { Upload, FileText, Copy, Download, Loader2, Check, AlertCircle, FolderUp, FileUp, X, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { extractData, ExtractionMode } from './lib/gemini';


const getBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      let encoded = reader.result?.toString().replace(/^data:(.*,)?/, '');
      if (encoded && (encoded.length % 4) > 0) {
        encoded += '='.repeat(4 - (encoded.length % 4));
      }
      resolve(encoded || '');
    };
    reader.onerror = error => reject(error);
  });
};

type FileStatus = 'pending' | 'processing' | 'success' | 'error';

interface FileState {
  file: File;
  id: string;
  status: FileStatus;
  error?: string;
  data?: any[];
}

interface Batch {
  id: string;
  name: string;
  files: FileState[];
  isExtracting: boolean;
  result: string | null;
  error: string | null;
  mode: ExtractionMode;
  createdAt: number;
}

const extractJsonFromText = (text: string): string => {
  // Remove markdown code blocks if present
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const cleanText = jsonMatch ? jsonMatch[1] : text;
  return cleanText.trim();
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'pdf' | 'text'>('pdf');
  const [textInput, setTextInput] = useState('');
  const [mode, setMode] = useState<ExtractionMode>('MHT-CET');
  const [minimal, setMinimal] = useState(false);
  
  // Batch State
  const [batches, setBatches] = useState<Batch[]>(() => {
    // Initialize with one default batch
    const defaultBatch: Batch = {
      id: Math.random().toString(36).substring(2, 9),
      name: 'Batch 1',
      files: [],
      isExtracting: false,
      result: null,
      error: null,
      mode: 'MHT-CET',
      createdAt: Date.now()
    };
    return [defaultBatch];
  });
  const [activeBatchId, setActiveBatchId] = useState<string | null>(batches[0]?.id || null);
  
  const [copied, setCopied] = useState(false);

  const activeBatch = batches.find(b => b.id === activeBatchId) || null;


  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const createBatch = () => {
    const newBatch: Batch = {
      id: Math.random().toString(36).substring(2, 9),
      name: `Batch ${batches.length + 1}`,
      files: [],
      isExtracting: false,
      result: null,
      error: null,
      mode: mode,
      createdAt: Date.now()
    };
    setBatches(prev => [...prev, newBatch]);
    setActiveBatchId(newBatch.id);
  };

  const removeBatch = (id: string) => {
    setBatches(prev => {
      const filtered = prev.filter(b => b.id !== id);
      if (filtered.length === 0) {
        // Always keep at least one batch
        const defaultBatch: Batch = {
          id: Math.random().toString(36).substring(2, 9),
          name: 'Batch 1',
          files: [],
          isExtracting: false,
          result: null,
          error: null,
          mode: mode,
          createdAt: Date.now()
        };
        setActiveBatchId(defaultBatch.id);
        return [defaultBatch];
      }
      if (activeBatchId === id) {
        setActiveBatchId(filtered[0].id);
      }
      return filtered;
    });
  };

  const renameBatch = (id: string, newName: string) => {
    setBatches(prev => prev.map(b => b.id === id ? { ...b, name: newName } : b));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeBatchId) return;
    if (e.target.files) {
      const selectedFiles = (Array.from(e.target.files) as File[]).filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
      
      const newFileStates: FileState[] = selectedFiles.map(file => ({
        file,
        id: (file.webkitRelativePath || file.name) + '-' + Math.random().toString(36).substring(2, 9),
        status: 'pending'
      }));

      setBatches(prev => prev.map(b => b.id === activeBatchId ? { ...b, files: [...b.files, ...newFileStates], error: null } : b));
    }
    if (e.target) e.target.value = '';
  };

  const removeFile = (id: string) => {
    if (!activeBatchId) return;
    setBatches(prev => prev.map(b => b.id === activeBatchId ? { ...b, files: b.files.filter(f => f.id !== id) } : b));
  };

  const clearFiles = () => {
    if (!activeBatchId) return;
    setBatches(prev => prev.map(b => b.id === activeBatchId ? { ...b, files: [], result: null, error: null } : b));
  };

  const handleExtract = async () => {
    if (activeTab === 'pdf' && (!activeBatch || activeBatch.files.length === 0)) {
      setBatches(prev => prev.map(b => b.id === activeBatchId ? { ...b, error: 'Please select at least one PDF file.' } : b));
      return;
    }
    if (activeTab === 'text' && !textInput.trim()) {
      setBatches(prev => prev.map(b => b.id === activeBatchId ? { ...b, error: 'Please enter some text first.' } : b));
      return;
    }

    if (!activeBatchId) return;

    setBatches(prev => prev.map(b => b.id === activeBatchId ? { ...b, isExtracting: true, error: null, result: null } : b));

    if (activeTab === 'text') {
      try {
        const extractedJson = await extractData({ text: textInput, mode, minimal });
        const cleanJson = extractJsonFromText(extractedJson);
        const parsed = JSON.parse(cleanJson);
        const resultStr = JSON.stringify(parsed, null, 2);
        setBatches(prev => prev.map(b => b.id === activeBatchId ? { ...b, result: resultStr, isExtracting: false } : b));
      } catch (err: any) {
        setBatches(prev => prev.map(b => b.id === activeBatchId ? { ...b, error: `Extraction failed: ${err.message || 'An error occurred.'}`, isExtracting: false } : b));
      }
      return;
    }


    // PDF Processing with Concurrency Limit
    const concurrencyLimit = 5;
    const currentFiles = activeBatch?.files || [];
    let queueIndex = 0;
    
    // Reset statuses for pending/error files
    setBatches(prev => prev.map(b => b.id === activeBatchId ? { 
      ...b, 
      files: b.files.map(f => f.status === 'success' ? f : { ...f, status: 'pending', error: undefined, data: undefined }) 
    } : b));

    const processNext = async () => {
      while (queueIndex < currentFiles.length) {
        const currentIndex = queueIndex++;
        const fileState = currentFiles[currentIndex];
        
        if (fileState.status === 'success') continue;

        setBatches(prev => prev.map(b => b.id === activeBatchId ? {
          ...b,
          files: b.files.map((f, i) => i === currentIndex ? { ...f, status: 'processing' } : f)
        } : b));

        try {
          const base64 = await getBase64(fileState.file);
          const extractedJson = await extractData({ pdfBase64: base64, mode, minimal });
          const cleanJson = extractJsonFromText(extractedJson);
          const parsed = JSON.parse(cleanJson);
          
          let dataArray: any[];
          if (mode === 'AIQ') {
            dataArray = Array.isArray(parsed.results) ? parsed.results : [];
          } else {
            dataArray = Array.isArray(parsed) ? parsed : [parsed];
          }

          setBatches(prev => prev.map(b => b.id === activeBatchId ? {
            ...b,
            files: b.files.map((f, i) => i === currentIndex ? { ...f, status: 'success', data: dataArray } : f)
          } : b));
        } catch (err: any) {
          setBatches(prev => prev.map(b => b.id === activeBatchId ? {
            ...b,
            files: b.files.map((f, i) => i === currentIndex ? { ...f, status: 'error', error: err.message || 'Extraction failed' } : f)
          } : b));
        }
      }
    };

    const workers = Array(Math.min(concurrencyLimit, currentFiles.length)).fill(null).map(() => processNext());
    await Promise.all(workers);

    // Final result aggregation for the batch
    setBatches(prev => prev.map(b => {
      if (b.id !== activeBatchId) return b;
      
      const allResults: any[] = [];
      b.files.forEach(f => {
        if (f.status === 'success' && f.data) {
          allResults.push(...f.data);
        }
      });

      let finalResult: string | null = null;
      let finalError: string | null = null;

      if (allResults.length > 0) {
        if (mode === 'AIQ') {
          finalResult = JSON.stringify({ results: allResults }, null, 2);
        } else {
          finalResult = JSON.stringify(allResults, null, 2);
        }
      } else {
        const hasErrors = b.files.some(f => f.status === 'error');
        if (hasErrors) {
          finalError = 'Failed to extract data from the provided files. Check individual file errors.';
        } else {
          finalError = 'No data could be extracted.';
        }
      }

      return { ...b, result: finalResult, error: finalError, isExtracting: false };
    }));
  };

  const handleCopy = () => {
    if (activeBatch?.result) {
      navigator.clipboard.writeText(activeBatch.result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (activeBatch?.result) {
      const blob = new Blob([activeBatch.result], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeBatch.name.toLowerCase().replace(/\s+/g, '_')}_${mode.toLowerCase().replace(/-/g, '_')}_cutoff.json`;

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const handleGlobalDownload = () => {
    const allBatchesResults: any = {
      generatedAt: new Date().toISOString(),
      batches: batches.map(b => {
        let data: any = null;
        if (b.result) {
          try {
            data = JSON.parse(b.result);
          } catch (e) {}
        }
        return {
          id: b.id,
          name: b.name,
          mode: b.mode,
          data: data
        };
      }).filter(b => b.data !== null)
    };

    if (allBatchesResults.batches.length === 0) return;

    const blob = new Blob([JSON.stringify(allBatchesResults, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `all_batches_cutoff.json`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">MHT-CET Extractor</h1>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={handleGlobalDownload}
              disabled={!batches.some(b => b.result)}
              className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-xs font-medium rounded-lg transition-colors shadow-sm"
            >
              <Download className="w-3.5 h-3.5" /> Download All
            </button>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer group">
                <div className="relative">
                  <input 
                    type="checkbox" 
                    className="sr-only" 
                    checked={minimal}
                    onChange={() => setMinimal(!minimal)}
                  />
                  <div className={`block w-8 h-5 rounded-full transition-colors ${minimal ? 'bg-indigo-600' : 'bg-slate-300'}`}></div>
                  <div className={`absolute left-1 top-1 bg-white w-3 h-3 rounded-full transition-transform ${minimal ? 'translate-x-3' : ''}`}></div>
                </div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider group-hover:text-slate-700 transition-colors">Minimal</span>
              </label>

              <div className="flex items-center bg-slate-100 p-1 rounded-lg">
              <button
                onClick={() => setMode('MHT-CET')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  mode === 'MHT-CET'
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                MHT-CET
              </button>
              <button
                onClick={() => setMode('AIQ')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  mode === 'AIQ'
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                AIQ
              </button>
              <button
                onClick={() => setMode('Pharmacy')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  mode === 'Pharmacy'
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Pharmacy
              </button>
            </div>
          </div>
        </div>

      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Batch Sidebar */}
          <div className="lg:col-span-3 flex flex-col gap-6">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[calc(100vh-10rem)]">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <FolderUp className="w-4 h-4 text-indigo-600" />
                  Batches
                </h2>
                <button 
                  onClick={createBatch}
                  className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                  title="Create new batch"
                >
                  <CheckCircle2 className="w-4 h-4" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {batches.map(batch => (
                  <div 
                    key={batch.id}
                    onClick={() => setActiveBatchId(batch.id)}
                    className={`group p-3 rounded-xl border transition-all cursor-pointer ${
                      activeBatchId === batch.id 
                        ? 'bg-indigo-50 border-indigo-200 ring-1 ring-indigo-200' 
                        : 'bg-white border-slate-100 hover:border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <input 
                        className={`text-xs font-bold bg-transparent border-none focus:ring-0 p-0 w-full truncate ${
                          activeBatchId === batch.id ? 'text-indigo-900' : 'text-slate-700'
                        }`}
                        value={batch.name}
                        onChange={(e) => renameBatch(batch.id, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      {batches.length > 1 && (
                        <button 
                          onClick={(e) => { e.stopPropagation(); removeBatch(batch.id); }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 rounded transition-all"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <FileText className={`w-3 h-3 ${activeBatchId === batch.id ? 'text-indigo-500' : 'text-slate-400'}`} />
                        <span className="text-[10px] text-slate-500 font-medium">{batch.files.length} PDFs</span>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {batch.isExtracting && (
                          <Loader2 className="w-3 h-3 text-indigo-500 animate-spin" />
                        )}
                        {batch.result && (
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        )}
                        {batch.error && (
                          <AlertCircle className="w-3 h-3 text-red-500" />
                        )}
                      </div>
                    </div>

                    {batch.files.length > 0 && (
                      <div className="mt-2 h-1 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-indigo-500 transition-all duration-500"
                          style={{ width: `${(batch.files.filter(f => f.status === 'success').length / batch.files.length) * 100}%` }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Input Section */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="flex border-b border-slate-200">
                <button
                  onClick={() => setActiveTab('pdf')}
                  className={`flex-1 py-3 text-sm font-medium transition-colors ${
                    activeTab === 'pdf'
                      ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Upload PDFs
                </button>
                <button
                  onClick={() => setActiveTab('text')}
                  className={`flex-1 py-3 text-sm font-medium transition-colors ${
                    activeTab === 'text'
                      ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Paste Text
                </button>
              </div>

              <div className="p-6">
                {activeTab === 'pdf' ? (
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={activeBatch?.isExtracting}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
                      >
                        <FileUp className="w-4 h-4" /> Add PDFs
                      </button>
                      <button
                        onClick={() => folderInputRef.current?.click()}
                        disabled={activeBatch?.isExtracting}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
                      >
                        <FolderUp className="w-4 h-4" /> Add Folder
                      </button>
                      {activeBatch && activeBatch.files.length > 0 && (
                        <button
                          onClick={clearFiles}
                          disabled={activeBatch.isExtracting}
                          className="flex items-center gap-2 px-4 py-2 ml-auto text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                        >
                          Clear Batch
                        </button>
                      )}
                    </div>

                    <input
                      type="file"
                      multiple
                      accept="application/pdf"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    <input
                      type="file"
                      multiple
                      accept="application/pdf"
                      ref={folderInputRef}
                      onChange={handleFileChange}
                      className="hidden"
                      {...({ webkitdirectory: "true", directory: "true" } as any)}
                    />

                    {activeBatch && activeBatch.files.length > 0 ? (
                      <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 bg-slate-50">
                        {activeBatch.files.map(f => (
                          <React.Fragment key={f.id}>
                            <div className="p-3 flex items-center justify-between bg-white hover:bg-slate-50 transition-colors">
                            <div className="flex items-center gap-3 overflow-hidden">
                              {f.status === 'pending' && <Clock className="w-4 h-4 text-slate-400 shrink-0" />}
                              {f.status === 'processing' && <Loader2 className="w-4 h-4 text-indigo-500 animate-spin shrink-0" />}
                              {f.status === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
                              {f.status === 'error' && <XCircle className="w-4 h-4 text-red-500 shrink-0" />}
                              
                              <div className="truncate">
                                <p className="text-sm font-medium text-slate-700 truncate" title={f.file.name}>{f.file.name}</p>
                                <p className="text-[10px] text-slate-400 truncate">
                                  {f.file.webkitRelativePath ? f.file.webkitRelativePath.replace(`/${f.file.name}`, '') : 'Root directory'} • {(f.file.size / 1024 / 1024).toFixed(2)} MB
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 ml-4">
                              <button
                                onClick={() => removeFile(f.id)}
                                disabled={activeBatch.isExtracting}
                                className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          {f.status === 'error' && f.error && (
                            <div className="px-10 pb-3 -mt-1">
                              <p className="text-[10px] text-red-400 bg-red-50/50 p-1.5 rounded border border-red-100/50 leading-tight">
                                <span className="font-bold">Error:</span> {f.error}
                              </p>
                            </div>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-xl p-10 bg-slate-50">
                        <Upload className="w-10 h-10 text-slate-400 mb-3" />
                        <p className="text-sm font-medium text-slate-900">No PDFs in this batch</p>
                        <p className="text-xs text-slate-500 mt-1 text-center">
                          Add files to <span className="font-bold text-indigo-600">{activeBatch?.name}</span> to start extracting.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <textarea
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    placeholder="Paste the contents of the MHT-CET cutoff document here..."
                    className="w-full h-64 p-4 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none font-mono"
                  />
                )}
              </div>
            </div>

            {activeBatch?.error && (
              <div className="flex items-start gap-3 p-4 bg-red-50 text-red-700 rounded-xl border border-red-100">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <p className="text-sm">{activeBatch.error}</p>
              </div>
            )}

            <button
              onClick={handleExtract}
              disabled={activeBatch?.isExtracting || (activeTab === 'pdf' ? (activeBatch?.files.length === 0) : !textInput.trim())}
              className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2"
            >
              {activeBatch?.isExtracting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Processing {activeTab === 'pdf' ? `${activeBatch.files.filter(f => f.status === 'success').length}/${activeBatch.files.length}` : 'Text'}...
                </>
              ) : (
                `Extract JSON Data ${activeTab === 'pdf' && activeBatch && activeBatch.files.length > 0 ? `(${activeBatch.files.length} files)` : ''}`
              )}
            </button>
            
            <p className="text-xs text-slate-500 text-center px-4">
              Results will be saved per batch. You can download individual batches or all at once.
            </p>
          </div>

          {/* Output Section */}
          <div className="lg:col-span-4 flex flex-col h-[calc(100vh-10rem)]">
            <div className="bg-slate-900 rounded-2xl shadow-sm overflow-hidden flex flex-col h-full border border-slate-800">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/50">
                <div className="flex flex-col">
                  <h2 className="text-sm font-medium text-slate-200 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${activeBatch?.result ? 'bg-emerald-500' : 'bg-slate-600'}`}></span>
                    {activeBatch?.name || 'Output'}
                  </h2>
                  {activeBatch?.files && activeBatch.files.some(f => f.status === 'error') && (
                    <span className="text-[10px] text-amber-400 font-medium">Some files failed</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopy}
                    disabled={!activeBatch?.result}
                    className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Copy to clipboard"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={handleDownload}
                    disabled={!activeBatch?.result}
                    className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Download JSON file"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 p-4 overflow-auto bg-[#0d1117]">
                {activeBatch?.result ? (
                  <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap break-words">
                    {activeBatch.result}
                  </pre>
                ) : activeBatch?.error ? (
                  <div className="h-full flex flex-col items-center justify-center text-red-400 space-y-4 p-8 text-center">
                    <AlertCircle className="w-12 h-12 opacity-50" />
                    <div>
                      <p className="text-sm font-medium text-red-300">Extraction Failed</p>
                      <p className="text-xs opacity-70 mt-2 max-w-xs mx-auto leading-relaxed">{activeBatch.error}</p>
                    </div>
                    <button 
                      onClick={handleExtract}
                      className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 px-4 py-2 rounded-lg border border-red-500/20 transition-colors"
                    >
                      Try Again
                    </button>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-4">
                    <div className="w-16 h-16 rounded-full border-2 border-dashed border-slate-700 flex items-center justify-center">
                      <span className="text-2xl">{"{}"}</span>
                    </div>
                    <p className="text-sm">Extracted JSON for {activeBatch?.name || 'batch'} will appear here</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
