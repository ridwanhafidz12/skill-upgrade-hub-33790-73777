import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { XCircle, Download, Link2, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

const CertificateVerify = () => {
  const { certificateNumber } = useParams();
  const [certificate, setCertificate] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [valid, setValid] = useState(false);
  const [templateUrl, setTemplateUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const certificateRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (certificateNumber) {
      verifyCertificate();
    }
  }, [certificateNumber]);

  const verifyCertificate = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('verify-certificate', {
        body: { certificateNumber }
      });

      if (error) throw error;

      if (data?.valid && data?.certificate) {
        setCertificate(data.certificate);
        setValid(true);
        
        // Fetch template URL from course
        if (data.certificate.course_id) {
          const { data: courseData } = await supabase
            .from('courses')
            .select('certificate_template_url')
            .eq('id', data.certificate.course_id)
            .single();
          
          if (courseData?.certificate_template_url) {
            // Get signed URL for private template
            const { data: signedData } = await supabase.storage
              .from('certificate-templates')
              .createSignedUrl(courseData.certificate_template_url, 3600);
            
            if (signedData?.signedUrl) {
              setTemplateUrl(signedData.signedUrl);
            }
          }
        }
      } else {
        setValid(false);
      }
    } catch (error) {
      console.error('Error verifying certificate:', error);
      setValid(false);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      const url = window.location.href;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast({
        title: "Link disalin!",
        description: "Link sertifikat berhasil disalin ke clipboard",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Gagal menyalin link",
        description: "Terjadi kesalahan saat menyalin link",
        variant: "destructive",
      });
    }
  };

  const handlePrintPDF = async () => {
    if (!certificateRef.current) return;
    
    setGenerating(true);
    try {
      // Wait for images to load
      const images = certificateRef.current.getElementsByTagName('img');
      await Promise.all(
        Array.from(images).map(img => {
          if (img.complete) return Promise.resolve();
          return new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
          });
        })
      );

      // Capture the certificate as canvas
      const canvas = await html2canvas(certificateRef.current, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
      });

      // Convert to PDF (A4 landscape)
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`Certificate-${certificateNumber}.pdf`);
      
      toast({
        title: "PDF berhasil dibuat!",
        description: "Sertifikat telah diunduh dalam format PDF",
      });
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast({
        title: "Gagal membuat PDF",
        description: "Terjadi kesalahan saat membuat PDF",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-secondary/30">
        <Navbar />
        <div className="container mx-auto px-4 py-16 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Memverifikasi sertifikat...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-secondary/30">
      <Navbar />

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-5xl mx-auto">
          {valid && certificate ? (
            <div className="space-y-6">
              {/* Certificate Display with Template Background */}
              <div 
                ref={certificateRef}
                className="relative w-full aspect-[1.414/1] max-w-4xl mx-auto bg-white rounded-lg shadow-2xl overflow-hidden"
              >
                {/* Template Background */}
                {templateUrl && (
                  <img 
                    src={templateUrl} 
                    alt="Certificate Template" 
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                )}
                
                {/* Overlay Content */}
                <div className="absolute inset-0 flex flex-col items-center justify-center p-8 md:p-12 text-center">
                  {/* Recipient Name */}
                  <div className="mb-6 md:mb-8">
                    <h2 className="text-3xl md:text-5xl font-bold text-gray-800 mb-2">
                      {certificate.profiles?.full_name}
                    </h2>
                  </div>

                  {/* Course Title */}
                  <div className="mb-6 md:mb-8">
                    <p className="text-base md:text-xl text-gray-700 mb-2">Telah menyelesaikan kursus</p>
                    <h3 className="text-2xl md:text-4xl font-semibold text-gray-900">
                      {certificate.courses?.title}
                    </h3>
                  </div>

                  {/* Date */}
                  <div className="mb-6 md:mb-8">
                    <p className="text-sm md:text-base text-gray-600">
                      Diterbitkan pada {new Date(certificate.issued_at).toLocaleDateString('id-ID', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric'
                      })}
                    </p>
                  </div>

                  {/* Certificate Number & QR Code */}
                  <div className="absolute bottom-6 md:bottom-8 right-6 md:right-8 flex flex-col items-center gap-2">
                    {certificate.qr_code_url && (
                      <div className="p-2 bg-white rounded-lg shadow-lg">
                        <img 
                          src={certificate.qr_code_url} 
                          alt="QR Code" 
                          className="w-20 h-20 md:w-24 md:h-24"
                        />
                      </div>
                    )}
                    <p className="text-xs text-gray-600 font-mono">{certificate.certificate_number}</p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-3 justify-center">
                <Button 
                  onClick={handlePrintPDF}
                  disabled={generating}
                  className="gap-2"
                >
                  <Download className="w-4 h-4" />
                  {generating ? "Membuat PDF..." : "Cetak PDF"}
                </Button>
                
                <Button 
                  onClick={handleCopyLink}
                  variant="outline"
                  className="gap-2"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
                  {copied ? "Link Disalin!" : "Copy Link"}
                </Button>
                
                <Link to="/courses">
                  <Button variant="outline">
                    Lihat Kursus Lainnya
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <Card className="border-2 border-destructive">
              <CardHeader className="text-center pb-6">
                <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
                  <XCircle className="h-10 w-10 text-destructive" />
                </div>
                <CardTitle className="text-2xl mb-2">Sertifikat Tidak Valid</CardTitle>
                <p className="text-muted-foreground">
                  Sertifikat dengan nomor <span className="font-mono font-semibold">{certificateNumber}</span> tidak ditemukan dalam sistem kami.
                </p>
              </CardHeader>
              <CardContent>
                <div className="p-4 bg-destructive/5 rounded-lg text-center space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Pastikan nomor sertifikat yang Anda masukkan benar atau hubungi administrator.
                  </p>
                  <Link to="/courses">
                    <Button variant="outline" className="w-full sm:w-auto">
                      Lihat Kursus Tersedia
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default CertificateVerify;
