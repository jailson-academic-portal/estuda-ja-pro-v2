import React from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface PrintableDocumentLayoutProps {
  title: string;
  disciplineName: string;
  teacherName?: string;
  date?: string;
  metadata?: Array<{ label: string; value: string }>;
  children: React.ReactNode;
  institutionLogo?: string;
}

/**
 * Universal layout for A4 printable documents.
 * Ensures standardized headers, margins, and page breaks.
 */
export const PrintableDocumentLayout: React.FC<PrintableDocumentLayoutProps> = ({
  title,
  disciplineName,
  teacherName,
  date,
  metadata = [],
  children,
  institutionLogo,
}) => {
  const displayDate = date || format(new Date(), "dd/MM/yyyy", { locale: ptBR });

  return (
    <div className="printable-document bg-white text-slate-900 font-sans p-8 print:p-0 min-h-[297mm] w-full max-w-[210mm] mx-auto overflow-hidden">
      {/* Global CSS for Print Control */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page {
            size: A4;
            margin: 1.5cm;
          }
          body {
            background: white !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .no-print {
            display: none !important;
          }
          
          /* 2) QUEBRA FORÇADA APENAS NO INÍCIO DE MÓDULO (h2) E DE CADA AULA (h3) */
          .page-break-before,
          .printable-document h2,
          .printable-document h3 {
            page-break-before: always;
            break-before: page;
          }
          
          /* Objetivos, subtítulos e caixas (Sugestão Visual, Para Refletir,
             Síntese) fluem continuamente: sem quebra forçada */
          .printable-document h4,
          .printable-document h5,
          .printable-document h6,
          .printable-document blockquote,
          .printable-document .callout,
          .printable-document .card,
          .printable-document .box {
            page-break-before: auto !important;
            break-before: auto !important;
            page-break-after: auto !important;
            break-after: auto !important;
          }
          
          .printable-document h3 {
            margin-top: 0 !important;
          }

          /* 3) EVITAR ÓRFÃOS: título não fica sozinho no pé da página */
          .printable-document h1, 
          .printable-document h2, 
          .printable-document h3, 
          .printable-document h4 {
            page-break-after: avoid;
            break-after: avoid;
          }
          
          /* Manter estruturas coesas (callouts, tabelas, caixas, listas de síntese) */
          .avoid-break,
          .printable-document table,
          .printable-document blockquote,
          .printable-document .callout,
          .printable-document .card,
          .printable-document .box,
          .printable-document ul,
          .printable-document ol,
          .printable-document pre,
          .printable-document img {
            page-break-inside: avoid;
            break-inside: avoid;
          }
        }
        
        /* 4) TIPOGRAFIA E DENSIDADE (livro-texto) */
        .printable-document {
          line-height: 1.35;
        }
        
        .printable-document p, 
        .printable-document li {
          font-size: 10pt;
          line-height: 1.35;
          text-align: justify;
          text-justify: inter-word;
        }
        
        .printable-document td,
        .printable-document th {
          font-size: 10pt;
          text-align: left;
        }
        
        .printable-document p {
          margin: 0 0 0.5rem 0;
        }
        
        .printable-document li {
          margin-bottom: 0.25rem;
        }

        .printable-document h1, 
        .printable-document h2, 
        .printable-document h3,
        .printable-document h4 {
          color: #0f172a;
          margin-bottom: 0.75rem;
        }
        
        .printable-document h2 {
          margin-top: 1.5rem;
        }

        /* Padronização de blocos e callouts (densidade compacta) */
        .printable-document blockquote,
        .printable-document .callout,
        .printable-document .card,
        .printable-document .box {
          padding: 8px 12px;
          margin: 8px 0;
          background: #f8fafc;
          border-left: 4px solid #cbd5e1;
        }

        .printable-document table {
          width: 100%;
          border-collapse: collapse;
          margin: 1rem 0;
        }
        .printable-document th, 
        .printable-document td {
          border: 1px solid #e2e8f0;
          padding: 8px 12px;
        }
        .printable-document th {
          background-color: #f8fafc;
          font-weight: 600;
        }
      `}} />

      {/* Standard Header */}
      <header className="border-b-2 border-slate-200 pb-4 mb-6">
        <div className="flex justify-between items-start gap-4 mb-4">
          <div className="flex-1">
            <h1 className="text-2xl font-bold uppercase tracking-tight m-0 text-slate-900">
              {title}
            </h1>
          </div>
          {institutionLogo && (
            <div className="shrink-0">
              <img 
                src={institutionLogo} 
                alt="Logo Institucional" 
                className="max-h-16 max-w-[200px] object-contain"
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-y-2 gap-x-4 text-xs">
          <div>
            <span className="font-bold text-slate-500 uppercase block mb-0.5">Disciplina</span>
            <span className="font-semibold text-slate-900">{disciplineName}</span>
          </div>
          <div>
            <span className="font-bold text-slate-500 uppercase block mb-0.5">Professor(a)</span>
            <span className="font-semibold text-slate-900">{teacherName || "Não informado"}</span>
          </div>
          <div>
            <span className="font-bold text-slate-500 uppercase block mb-0.5">Data</span>
            <span className="font-semibold text-slate-900">{displayDate}</span>
          </div>
          {metadata.map((item, idx) => (
            <div key={idx}>
              <span className="font-bold text-slate-500 uppercase block mb-0.5">{item.label}</span>
              <span className="font-semibold text-slate-900">{item.value}</span>
            </div>
          ))}
        </div>
      </header>

      {/* Main Content */}
      <main className="document-content text-slate-800">
        {children}
      </main>

      {/* Footer (Page numbers, etc - optional) */}
      <footer className="mt-8 pt-4 border-t border-slate-100 text-[10px] text-slate-400 text-center no-print">
        Documento gerado automaticamente pela plataforma EstudaJá.
      </footer>
    </div>
  );
};
