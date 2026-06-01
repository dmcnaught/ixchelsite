// Navigation Bar Scroll Effect
const navbar = document.getElementById('navbar');

window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }
});

// Mobile Menu Toggle
const hamburger = document.querySelector('.hamburger');
const navLinks = document.querySelector('.nav-links');

hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('active');
    navLinks.classList.toggle('active');
    
    // Toggle dark styling to the navbar when open on mobile so it's readable if at top
    if (window.scrollY <= 50) {
        navbar.classList.toggle('scrolled');
    }
});

// Close mobile menu when a link is clicked
document.querySelectorAll('.nav-links li a').forEach(link => {
    link.addEventListener('click', () => {
        hamburger.classList.remove('active');
        navLinks.classList.remove('active');
        if (window.scrollY <= 50) {
            navbar.classList.remove('scrolled');
        }
    });
});

// Intersection Observer for Scroll Animations
const revealElements = document.querySelectorAll('.reveal');

const revealCallback = (entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('active');
            // Optional: observer.unobserve(entry.target) if you only want it to animate once
        }
    });
};

const revealOptions = {
    root: null,
    rootMargin: '0px',
    threshold: 0.15 // Triggers when 15% of the element is visible
};

const revealObserver = new IntersectionObserver(revealCallback, revealOptions);

revealElements.forEach(el => {
    revealObserver.observe(el);
});

// Trigger reveal immediately for elements already in viewport on load
document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
        // Hero content should appear instantly without waiting for scroll
        document.querySelector('.hero-content.reveal').classList.add('active');
    }, 100);
});

// ============================
//  Meta Pixel: ViewContent Events for Retargeting
//  Fires once per section per page view when visitor scrolls to key sections.
//  This gives Facebook better signal to build retargeting audiences.
// ============================
(function() {
    const pixelSections = [
        { id: 'gallery',    contentName: 'Gallery',       contentCategory: 'Engagement' },
        { id: 'calculator', contentName: 'Rate Calculator', contentCategory: 'High Intent' },
        { id: 'contact',    contentName: 'Contact',       contentCategory: 'High Intent' }
    ];

    const firedSections = new Set();

    const pixelObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !firedSections.has(entry.target.id)) {
                firedSections.add(entry.target.id);
                const section = pixelSections.find(s => s.id === entry.target.id);
                if (section && typeof fbq === 'function') {
                    fbq('track', 'ViewContent', {
                        content_name: section.contentName,
                        content_category: section.contentCategory,
                        content_type: 'product'
                    });
                }
                if (section && typeof gtag === 'function') {
                    gtag('event', 'view_section', {
                        section_name: section.contentName,
                        section_category: section.contentCategory
                    });
                }
            }
        });
    }, { threshold: 0.3 });

    pixelSections.forEach(section => {
        const el = document.getElementById(section.id);
        if (el) pixelObserver.observe(el);
    });
})();

// Handle contact form submission via AJAX to ensure redirect to thanks.html
// (Formspree's built-in _next redirect was not working, which prevented
// the Meta Lead pixel event on thanks.html from firing)
const contactForm = document.getElementById('contact-form');
if (contactForm) {
    contactForm.addEventListener('submit', function(e) {
        e.preventDefault();
        const form = e.target;
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Sending...';
        submitBtn.disabled = true;

        fetch(form.action, {
            method: 'POST',
            body: new FormData(form),
            headers: { 'Accept': 'application/json' }
        })
        .then(response => {
            if (response.ok) {
                window.location.href = 'https://ixchel603and604.com/thanks.html';
            } else {
                throw new Error('Form submission failed');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            submitBtn.textContent = 'Error — Please try again';
            submitBtn.disabled = false;
            setTimeout(() => { submitBtn.textContent = originalText; }, 3000);
        });
    });
}
