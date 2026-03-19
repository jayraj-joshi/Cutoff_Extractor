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

const extractJsonFromText = (text: string): string => {
  // Remove markdown code blocks if present
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const cleanText = jsonMatch ? jsonMatch[1] : text;
  return cleanText.trim();
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'pdf' | 'text'>('pdf');
  const [textInput, setTextInput] = useState('');
  const [files, setFiles] = useState<FileState[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<ExtractionMode>('MHT-CET');


  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = (Array.from(e.target.files) as File[]).filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
      
      const newFileStates: FileState[] = selectedFiles.map(file => ({
        file,
        id: (file.webkitRelativePath || file.name) + '-' + Math.random().toString(36).substring(2, 9),
        status: 'pending'
      }));

      setFiles(prev => [...prev, ...newFileStates]);
      setError(null);
    }
    if (e.target) e.target.value = '';
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const clearFiles = () => {
    setFiles([]);
    setResult(null);
    setError(null);
  };

  const handleExtract = async () => {
    if (activeTab === 'pdf' && files.length === 0) {
      setError('Please select at least one PDF file.');
      return;
    }
    if (activeTab === 'text' && !textInput.trim()) {
      setError('Please enter some text first.');
      return;
    }

    setIsExtracting(true);
    setError(null);
    setResult(null);

    if (activeTab === 'text') {
      try {
        const extractedJson = await extractData({ text: textInput, mode });
        const cleanJson = extractJsonFromText(extractedJson);
        const parsed = JSON.parse(cleanJson);
        setResult(JSON.stringify(parsed, null, 2));
      } catch (err: any) {
        setError(`Extraction failed: ${err.message || 'An error occurred.'}`);
      } finally {
        setIsExtracting(false);
      }
      return;
    }


    // PDF Processing with Concurrency Limit
    const concurrencyLimit = 5;
    let queueIndex = 0;
    const allResults: any[] = [];
    
    // Reset statuses for pending/error files
    setFiles(prev => prev.map(f => f.status === 'success' ? f : { ...f, status: 'pending', error: undefined, data: undefined }));

    const processNext = async () => {
      while (queueIndex < files.length) {
        const currentIndex = queueIndex++;
        const fileState = files[currentIndex];
        
        if (fileState.status === 'success') {
           if (fileState.data) allResults.push(...fileState.data);
           continue;
        }

        setFiles(prev => prev.map((f, i) => i === currentIndex ? { ...f, status: 'processing' } : f));

        try {
          const base64 = await getBase64(fileState.file);
          const extractedJson = await extractData({ pdfBase64: base64, mode });
          const cleanJson = extractJsonFromText(extractedJson);
          const parsed = JSON.parse(cleanJson);
          
          let dataArray: any[];
          if (mode === 'AIQ') {
            dataArray = Array.isArray(parsed.results) ? parsed.results : [];
          } else {
            dataArray = Array.isArray(parsed) ? parsed : [parsed];
          }
          allResults.push(...dataArray);

          setFiles(prev => prev.map((f, i) => i === currentIndex ? { ...f, status: 'success', data: dataArray } : f));
        } catch (err: any) {
          setFiles(prev => prev.map((f, i) => i === currentIndex ? { ...f, status: 'error', error: err.message || 'Extraction failed' } : f));
        }

      }
    };

    const workers = Array(Math.min(concurrencyLimit, files.length)).fill(null).map(() => processNext());
    await Promise.all(workers);

    if (allResults.length > 0) {
      if (mode === 'AIQ') {
        setResult(JSON.stringify({ results: allResults }, null, 2));
      } else {
        setResult(JSON.stringify(allResults, null, 2));
      }
    } else {

      const hasErrors = files.some(f => f.status === 'error');
      if (hasErrors) {
         setError('Failed to extract data from the provided files. Check individual file errors.');
      } else {
         setError('No data could be extracted.');
      }
    }

    setIsExtracting(false);
  };

  const handleCopy = () => {
    if (result) {
      navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (result) {
      const blob = new Blob([result], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = mode === 'AIQ' ? 'aiq_cutoff.json' : 'mht_cet_cutoff.json';

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
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
            </div>
          </div>
        </div>

      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Input Section */}
          <div className="flex flex-col gap-6">
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
                        disabled={isExtracting}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
                      >
                        <FileUp className="w-4 h-4" /> Add PDFs
                      </button>
                      <button
                        onClick={() => folderInputRef.current?.click()}
                        disabled={isExtracting}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
                      >
                        <FolderUp className="w-4 h-4" /> Add Folder
                      </button>
                      {files.length > 0 && (
                        <button
                          onClick={clearFiles}
                          disabled={isExtracting}
                          className="flex items-center gap-2 px-4 py-2 ml-auto text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                        >
                          Clear All
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

                    {files.length > 0 ? (
                      <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 bg-slate-50">
                        {files.map(f => (
                          <React.Fragment key={f.id}>
                            <div className="p-3 flex items-center justify-between bg-white hover:bg-slate-50 transition-colors">
                            <div className="flex items-center gap-3 overflow-hidden">
                              {f.status === 'pending' && <Clock className="w-4 h-4 text-slate-400 shrink-0" />}
                              {f.status === 'processing' && <Loader2 className="w-4 h-4 text-indigo-500 animate-spin shrink-0" />}
                              {f.status === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
                              {f.status === 'error' && <XCircle className="w-4 h-4 text-red-500 shrink-0" />}
                              
                              <div className="truncate">
                                <p className="text-sm font-medium text-slate-700 truncate">{f.file.name}</p>
                                <p className="text-xs text-slate-400 truncate">
                                  {f.file.webkitRelativePath ? f.file.webkitRelativePath.replace(`/${f.file.name}`, '') : 'Root directory'} • {(f.file.size / 1024 / 1024).toFixed(2)} MB
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 ml-4">
                              {f.status === 'error' && (
                                <span className="text-xs text-red-500 font-medium" title={f.error}>
                                  Error
                                </span>
                              )}
                              <button
                                onClick={() => removeFile(f.id)}
                                disabled={isExtracting}
                                className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          {f.status === 'error' && f.error && (
                            <div className="px-10 pb-3 -mt-1">
                              <p className="text-[10px] text-red-400 bg-red-50/50 p-1.5 rounded border border-red-100/50 leading-tight">
                                {f.error}
                              </p>
                            </div>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-xl p-10 bg-slate-50">
                        <Upload className="w-10 h-10 text-slate-400 mb-3" />
                        <p className="text-sm font-medium text-slate-900">No PDFs selected</p>
                        <p className="text-xs text-slate-500 mt-1 text-center">
                          Click "Add PDFs" to select files or "Add Folder" to upload an entire directory of PDFs.
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

            {error && (
              <div className="flex items-start gap-3 p-4 bg-red-50 text-red-700 rounded-xl border border-red-100">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <p className="text-sm">{error}</p>
              </div>
            )}

            <button
              onClick={handleExtract}
              disabled={isExtracting || (activeTab === 'pdf' ? files.length === 0 : !textInput.trim())}
              className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2"
            >
              {isExtracting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Processing {activeTab === 'pdf' ? `${files.filter(f => f.status === 'success').length}/${files.length}` : 'Text'}...
                </>
              ) : (
                `Extract JSON Data ${activeTab === 'pdf' && files.length > 0 ? `(${files.length} files)` : ''}`
              )}
            </button>
            
            <p className="text-xs text-slate-500 text-center px-4">
              This process uses Gemini 2.5 Flash to analyze the documents in parallel. Large batches may take a few moments.
            </p>
          </div>

          {/* Output Section */}
          <div className="flex flex-col h-[calc(100vh-10rem)]">
            <div className="bg-slate-900 rounded-2xl shadow-sm overflow-hidden flex flex-col h-full border border-slate-800">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/50">
                <h2 className="text-sm font-medium text-slate-200 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  JSON Output
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopy}
                    disabled={!result}
                    className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Copy to clipboard"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={handleDownload}
                    disabled={!result}
                    className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Download JSON file"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 p-4 overflow-auto bg-[#0d1117]">
                {result ? (
                  <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap break-words">
                    {result}
                  </pre>
                ) : error ? (
                  <div className="h-full flex flex-col items-center justify-center text-red-400 space-y-4 p-8 text-center">
                    <AlertCircle className="w-12 h-12 opacity-50" />
                    <div>
                      <p className="text-sm font-medium text-red-300">Extraction Failed</p>
                      <p className="text-xs opacity-70 mt-2 max-w-xs mx-auto leading-relaxed">{error}</p>
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
                    <p className="text-sm">Extracted JSON will appear here</p>
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
