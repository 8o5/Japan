
			const links = [...document.querySelectorAll('.nav a')];
			const observer = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) {
						if (entry.isIntersecting) {
							links.forEach((a) => {
								const yes = a.hash === '#' + entry.target.id;
								a.classList.toggle('active', yes);
								if (yes) a.setAttribute('aria-current', 'location');
								else a.removeAttribute('aria-current');
							});
						}
					}
				},
				{ rootMargin: '-10% 0px -65% 0px', threshold: 0 }
			);
			document.querySelectorAll('.day,.booking-section').forEach((d) => observer.observe(d));
			let printState = [];
			window.addEventListener('beforeprint', () => {
				printState = [...document.querySelectorAll('details.more')].map((d) => d.open);
				document.querySelectorAll('details.more').forEach((d) => (d.open = true));
			});
			window.addEventListener('afterprint', () => document.querySelectorAll('details.more').forEach((d, i) => (d.open = printState[i])));
		